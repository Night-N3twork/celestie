import { randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { type BrowserWindow, dialog } from "electron";
import type { NativeStat } from "../src/platform/desktop/bridge";
import type { ExplorerEntry, TextFile } from "../src/platform/host";
import type { FileChange } from "../src/platform/services";

interface Grant {
	id: string;
	path: string;
	kind: ExplorerEntry["kind"];
}
const failure = (code: string, message: string) =>
	Object.assign(new Error(message), { code });
const same = (a: string, b: string) =>
	process.platform === "win32"
		? a.toLowerCase() === b.toLowerCase()
		: a === b;
function contains(parent: string, target: string) {
	const relative = path.relative(parent, target);
	return (
		relative === "" ||
		(!path.isAbsolute(relative) &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`))
	);
}
export class NativeWorkspace {
	private grants = new Map<string, Grant>();
	private watchers = new Map<string, FSWatcher>();
	private writes = new Map<string, Promise<void>>();
	private persistence: Promise<void> = Promise.resolve();
	constructor(
		private stateFile: string,
		private send: (change: FileChange) => void,
	) {}
	async load() {
		try {
			const state: unknown = JSON.parse(
				await fs.readFile(this.stateFile, "utf8"),
			);
			if (Array.isArray(state))
				for (const entry of state) {
					if (
						entry &&
						typeof entry.id === "string" &&
						typeof entry.path === "string" &&
						path.isAbsolute(entry.path) &&
						["file", "directory"].includes(entry.kind) &&
						/^(?:native:)?[\da-f-]{36}$/i.test(entry.id)
					)
						this.grants.set(entry.id, entry);
				}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				console.error("Could not restore native folders:", error);
		}
	}
	private persist() {
		const data = JSON.stringify([...this.grants.values()]);
		this.persistence = this.persistence
			.catch(() => {})
			.then(async () => {
				await fs.mkdir(path.dirname(this.stateFile), {
					recursive: true,
				});
				const temp = `${this.stateFile}.tmp`;
				await fs.writeFile(temp, data);
				await fs.rename(temp, this.stateFile);
			});
		return this.persistence;
	}
	private async grant(
		target: string,
		kind: Grant["kind"],
		id = `native:${randomUUID()}`,
	) {
		const real = await fs.realpath(target);
		this.grants.set(id, { id, path: real, kind });
		await this.persist();
		if (kind === "directory") this.startWatch(this.grants.get(id) as Grant);
		return { id, name: path.basename(real), kind };
	}
	private idForPath(target: string) {
		for (const grant of [...this.grants.values()].sort(
			(a, b) =>
				Number(b.kind === "directory") -
					Number(a.kind === "directory") ||
				b.path.length - a.path.length,
		)) {
			if (same(grant.path, target)) return grant.id;
			if (grant.kind === "directory" && contains(grant.path, target))
				return `${grant.id}/${path.relative(grant.path, target).split(path.sep).join("/")}`;
		}
	}
	private async resolve(id: string, follow = true): Promise<string> {
		const [key, ...parts] = id.split("/"),
			grant = this.grants.get(key);
		if (
			!grant ||
			parts.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[\\\0:]/.test(part),
			) ||
			(grant.kind === "file" && parts.length)
		)
			throw failure(
				"EACCES",
				"This path is outside the opened workspace.",
			);
		const target = path.join(grant.path, ...parts);
		if (!contains(grant.path, target))
			throw failure("EACCES", "Invalid workspace path.");
		if (grant.kind === "file") {
			const real = await fs.realpath(target);
			if (!same(real, grant.path))
				throw failure("EACCES", "File target changed. Reopen it.");
			return target;
		}
		let check = follow ? target : path.dirname(target);
		if (same(target, grant.path)) check = target;
		while (true) {
			try {
				const real = await fs.realpath(check);
				if (!contains(grant.path, real))
					throw failure(
						"EACCES",
						"Symbolic link leaves the opened folder.",
					);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					throw error;
				const parent = path.dirname(check);
				if (parent === check) throw error;
				check = parent;
			}
		}
		return target;
	}
	private name(name: string) {
		if (
			!name ||
			name === "." ||
			name === ".." ||
			/[<>:"/\\|?*\0]/.test(name) ||
			/[. ]$/.test(name)
		)
			throw failure("EINVAL", "Enter a valid file or folder name.");
		return name;
	}
	async openFolder(window: BrowserWindow) {
		const result = await dialog.showOpenDialog(window, {
			properties: ["openDirectory"],
		});
		if (result.canceled || !result.filePaths[0]) return;
		const target = await fs.realpath(result.filePaths[0]);
		const known = [...this.grants.values()].find(
			(grant) => grant.kind === "directory" && same(grant.path, target),
		);
		if (known) {
			this.startWatch(known);
			return {
				id: known.id,
				name: path.basename(target),
				kind: "directory" as const,
			};
		}
		return this.grant(target, "directory");
	}
	async openFile(window: BrowserWindow) {
		const result = await dialog.showOpenDialog(window, {
			properties: ["openFile"],
		});
		if (result.canceled || !result.filePaths[0]) return;
		const target = await fs.realpath(result.filePaths[0]);
		const id =
			this.idForPath(target) ?? (await this.grant(target, "file")).id;
		const value = await this.readBytes(id);
		return {
			id,
			name: value.name,
			text: new TextDecoder().decode(value.bytes),
		};
	}
	async restore() {
		const folders: { entry: ExplorerEntry; accessible: boolean }[] = [];
		for (const grant of this.grants.values())
			if (grant.kind === "directory") {
				const accessible = await this.reconnect(grant.id);
				folders.push({
					entry: {
						id: grant.id,
						name: path.basename(grant.path),
						kind: "directory",
					},
					accessible,
				});
			}
		return { folders, files: [...this.grants.keys()] };
	}
	async reconnect(id: string) {
		try {
			await fs.access(await this.resolve(id), fs.constants.R_OK);
			const grant = this.grants.get(id);
			if (grant?.kind === "directory") this.startWatch(grant);
			return true;
		} catch {
			return false;
		}
	}
	async removeRoot(id: string) {
		const grant = this.grants.get(id);
		if (grant?.kind !== "directory")
			throw failure("EINVAL", "Unknown folder.");
		this.grants.delete(id);
		this.watchers.get(id)?.close();
		this.watchers.delete(id);
		await this.persist();
	}
	async readDirectory(id: string) {
		const target = await this.resolve(id),
			entries: ExplorerEntry[] = [];
		for (const entry of await fs.readdir(target, { withFileTypes: true })) {
			const child = `${id}/${entry.name}`;
			try {
				const info = await fs.stat(await this.resolve(child));
				entries.push({
					id: this.idForPath(path.join(target, entry.name)) ?? child,
					name: entry.name,
					kind: info.isDirectory() ? "directory" : "file",
				});
			} catch (error) {
				if (
					!["EACCES", "ENOENT", "EPERM"].includes(
						(error as NodeJS.ErrnoException).code ?? "",
					)
				)
					throw error;
			}
		}
		return entries.sort((a, b) =>
			a.kind === b.kind
				? a.name.localeCompare(b.name)
				: a.kind === "directory"
					? -1
					: 1,
		);
	}
	async readBytes(id: string) {
		const target = await this.resolve(id),
			info = await fs.stat(target);
		if (!info.isFile()) throw failure("EISDIR", "Select a file.");
		return {
			id: this.idForPath(target) ?? id,
			bytes: new Uint8Array(await fs.readFile(target)),
			name: path.basename(target),
			modified: info.mtimeMs,
		};
	}
	async stat(id: string): Promise<NativeStat> {
		const target = await this.resolve(id),
			info = await fs.stat(target);
		return {
			kind: info.isDirectory() ? "directory" : "file",
			size: info.size,
			modified: info.mtimeMs,
			stamp: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
		};
	}
	private async atomicWrite(
		id: string,
		data: Uint8Array,
		expected?: { stamp?: string; text?: string; overwrite?: boolean },
	) {
		const previous = this.writes.get(id) ?? Promise.resolve();
		const write = previous
			.catch(() => {})
			.then(async () => {
				const target = await this.resolve(id);
				let before: NativeStat | undefined;
				try {
					before = await this.stat(id);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT")
						throw error;
				}
				if (expected?.stamp && before?.stamp !== expected.stamp)
					throw failure(
						"ESTALE",
						"File changed while writing. Reload and retry.",
					);
				if (
					expected &&
					!expected.overwrite &&
					"text" in expected &&
					before &&
					(await fs.readFile(target, "utf8")) !== expected.text
				)
					throw failure(
						"ESTALE",
						"File changed on disk. Reload or explicitly overwrite it.",
					);
				const temp = path.join(
					path.dirname(target),
					`.celestie-${randomUUID()}.tmp`,
				);
				const mode = before ? (await fs.stat(target)).mode : 0o666;
				try {
					const handle = await fs.open(temp, "wx", mode);
					try {
						await handle.writeFile(data);
						await handle.sync();
					} finally {
						await handle.close();
					}
					await this.resolve(id);
					let current: NativeStat | undefined;
					try {
						current = await this.stat(id);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT")
							throw error;
					}
					if (before?.stamp !== current?.stamp)
						throw failure(
							"ESTALE",
							"File changed while saving. The write was cancelled.",
						);
					await fs.rename(temp, target);
				} finally {
					await fs.rm(temp, { force: true });
				}
			});
		this.writes.set(id, write);
		try {
			await write;
		} finally {
			if (this.writes.get(id) === write) this.writes.delete(id);
		}
	}
	async saveText(
		window: BrowserWindow,
		id: string,
		text: string,
		name: string,
		options?: { expectedText?: string; overwrite?: boolean },
	) {
		if (!this.grants.has(id.split("/")[0])) {
			if (!/^[\da-f-]{36}$/i.test(id))
				throw failure(
					"EACCES",
					"This file is no longer authorized. Reopen it.",
				);
			const result = await dialog.showSaveDialog(window, {
				defaultPath: path.basename(name),
			});
			if (result.canceled || !result.filePath)
				throw failure("ECANCELED", "Save cancelled.");
			const target = path.resolve(result.filePath);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, text, "utf8");
			await this.grant(target, "file", id);
			return {
				id: this.idForPath(target) ?? id,
				name: path.basename(target),
			};
		}
		await this.atomicWrite(
			id,
			new TextEncoder().encode(text),
			options
				? { text: options.expectedText, overwrite: options.overwrite }
				: undefined,
		);
		const target = await this.resolve(id);
		return {
			id: this.idForPath(target) ?? id,
			name: path.basename(target),
		};
	}
	async writeBytes(id: string, data: Uint8Array, stamp: string) {
		await this.atomicWrite(id, data, { stamp });
	}
	async create(parent: string, name: string, kind: ExplorerEntry["kind"]) {
		this.name(name);
		const id = `${parent}/${name}`,
			target = await this.resolve(id);
		if (kind === "directory") await fs.mkdir(target);
		else {
			const file = await fs.open(target, "wx");
			await file.close();
		}
		return { id, name, kind };
	}
	async remove(id: string, recursive: boolean) {
		if (this.grants.get(id)?.kind === "directory")
			throw failure("EPERM", "Workspace roots cannot be deleted here.");
		const target = await this.resolve(id, false);
		const info = await fs.lstat(target);
		if (info.isDirectory() && !info.isSymbolicLink() && !recursive)
			await fs.rmdir(target);
		else await fs.rm(target, { recursive });
	}
	async move(id: string, parent: string, name: string) {
		this.name(name);
		if (this.grants.get(id)?.kind === "directory")
			throw failure("EPERM", "Workspace roots cannot be moved here.");
		const destination = `${parent}/${name}`;
		if (destination === id || destination.startsWith(`${id}/`))
			throw failure("EINVAL", "Invalid move destination.");
		const from = await this.resolve(id, false),
			to = await this.resolve(destination);
		try {
			await fs.lstat(to);
			throw failure("EEXIST", "Destination already exists.");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const info = await fs.lstat(from);
		await fs.rename(from, to);
		const grant = this.grants.get(id);
		if (grant) {
			grant.path = to;
			await this.persist();
		}
		return {
			id: grant ? id : destination,
			name,
			kind: info.isDirectory()
				? ("directory" as const)
				: ("file" as const),
		};
	}
	async exportText(window: BrowserWindow, file: TextFile) {
		const result = await dialog.showSaveDialog(window, {
			defaultPath: path.basename(file.name),
		});
		if (!result.canceled && result.filePath)
			await fs.writeFile(result.filePath, file.text, "utf8");
	}
	private startWatch(grant: Grant) {
		if (this.watchers.has(grant.id)) return;
		try {
			const watcher = watch(
				grant.path,
				{ recursive: true },
				(_event, name) => {
					if (
						!name ||
						name
							.split(/[\\/]/)
							.some((part) => part.startsWith(".celestie-"))
					)
						return;
					const id = `${grant.id}/${name.split(path.sep).join("/")}`;
					void this.resolve(id)
						.then((target) => fs.stat(target))
						.then(() => this.send({ id, type: "changed" }))
						.catch((error) =>
							this.send({
								id,
								type:
									(error as NodeJS.ErrnoException).code ===
									"ENOENT"
										? "removed"
										: "error",
								message: String(error),
							}),
						);
				},
			);
			watcher.on("error", (error) => {
				this.watchers.delete(grant.id);
				watcher.close();
				this.send({
					id: grant.id,
					type: "error",
					message: error.message,
				});
			});
			this.watchers.set(grant.id, watcher);
		} catch (error) {
			this.send({ id: grant.id, type: "error", message: String(error) });
		}
	}
	close() {
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
	}
}
