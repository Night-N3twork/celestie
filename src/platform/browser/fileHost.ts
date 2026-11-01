import type { ExplorerEntry, FileHost, TextFile } from "../host";
import { readFolder, writeFolder } from "./folderStorage";

interface FileHandle {
	readonly kind: "file";
	readonly name: string;
	isSameEntry?(other: FileHandle): Promise<boolean>;
	getFile(): Promise<File>;
	createWritable(): Promise<{
		write(text: string | Blob): Promise<void>;
		close(): Promise<void>;
		abort?(): Promise<void>;
	}>;
}
interface DirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	isSameEntry?(other: DirectoryHandle): Promise<boolean>;
	values(): AsyncIterable<FileHandle | DirectoryHandle>;
	queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
	requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
	getDirectoryHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<DirectoryHandle>;
	getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<FileHandle>;
	removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
interface StoredFolder {
	version: 1;
	entry: ExplorerEntry;
	handle?: DirectoryHandle;
	children?: [string, ExplorerEntry[]][];
	files?: [string, File][];
}
interface PickerWindow {
	showDirectoryPicker?: () => Promise<DirectoryHandle>;
	showOpenFilePicker?: () => Promise<FileHandle[]>;
	showSaveFilePicker?: (options: {
		suggestedName: string;
	}) => Promise<FileHandle>;
}

export class BrowserFileHost implements FileHost {
	private storedRoots = new Map<string, StoredFolder>();
	folderPersistenceError = "";
	private async persistFolder(folder: StoredFolder): Promise<void> {
		try {
			this.storedRoots.set(folder.entry.id, folder);
			await writeFolder({
				version: 2,
				folders: [...this.storedRoots.values()],
			});
			this.folderPersistenceError = "";
		} catch {
			this.folderPersistenceError = "Folder could not be saved.";
		}
	}

	async restoreFolder(): Promise<
		{ entry: ExplorerEntry; accessible: boolean } | undefined
	> {
		return (await this.restoreFolders()).at(-1);
	}

	async restoreFolders(): Promise<
		{ entry: ExplorerEntry; accessible: boolean }[]
	> {
		const data = await readFolder<
			StoredFolder | { version: 2; folders: StoredFolder[] }
		>();
		const roots = data?.version === 2 ? data.folders : data ? [data] : [];
		const restored: { entry: ExplorerEntry; accessible: boolean }[] = [];
		for (const stored of roots)
			restored.push(await this.restoreRoot(stored));
		return restored;
	}

	private async restoreRoot(
		stored: StoredFolder,
	): Promise<{ entry: ExplorerEntry; accessible: boolean }> {
		if (
			stored.version !== 1 ||
			stored.entry?.kind !== "directory" ||
			typeof stored.entry.id !== "string" ||
			typeof stored.entry.name !== "string"
		)
			throw new Error("Invalid saved folder");
		this.storedRoots.set(stored.entry.id, stored);
		if (stored.handle) {
			this.directories.set(stored.entry.id, stored.handle);
			const permission = await stored.handle.queryPermission?.({
				mode: "read",
			});
			return {
				entry: stored.entry,
				accessible:
					permission === undefined || permission === "granted",
			};
		}
		for (const [id, entries] of stored.children ?? [])
			this.children.set(id, entries);
		for (const [id, file] of stored.files ?? [])
			this.imported.set(id, file);
		return { entry: stored.entry, accessible: true };
	}

	async reconnectFolder(id: string): Promise<boolean> {
		const handle = this.directories.get(id);
		if (!handle) return false;
		return (
			(await handle.requestPermission?.({ mode: "read" })) === "granted"
		);
	}

	private async resolveFileHandle(
		id: string,
	): Promise<FileHandle | undefined> {
		const known = this.handles.get(id);
		if (known) return known;
		for (const [directoryId, handle] of this.directories) {
			if (!id.startsWith(`${directoryId}/`)) continue;
			const parts = id.slice(directoryId.length + 1).split("/");
			let directory = handle;
			for (const name of parts.slice(0, -1))
				directory = await directory.getDirectoryHandle(name);
			const file = await directory.getFileHandle(parts[parts.length - 1]);
			this.handles.set(id, file);
			return file;
		}
	}
	private directories = new Map<string, DirectoryHandle>();
	private children = new Map<string, ExplorerEntry[]>();
	private imported = new Map<string, File>();
	private handles = new Map<string, FileHandle>();
	private names = new Map<string, string>();
	private get pickers() {
		return window as unknown as PickerWindow;
	}

	remember(file: Pick<TextFile, "id" | "name">): void {
		this.names.set(file.id, file.name);
	}

	async openTextFile(): Promise<TextFile | undefined> {
		try {
			let file: File;
			let handle: FileHandle | undefined;
			if (this.pickers.showOpenFilePicker) {
				[handle] = await this.pickers.showOpenFilePicker();
				if (!handle) return;
				file = await handle.getFile();
			} else {
				const selected = await new Promise<File | undefined>(
					(resolve) => {
						const input = document.createElement("input");
						input.type = "file";
						input.onchange = () => resolve(input.files?.[0]);
						input.oncancel = () => resolve(undefined);
						input.click();
					},
				);
				if (!selected) return;
				file = selected;
			}
			let id = crypto.randomUUID() as string;
			if (handle?.isSameEntry) {
				for (const [knownId, knownHandle] of this.handles) {
					if (await handle.isSameEntry(knownHandle)) {
						id = knownId;
						break;
					}
				}
			}
			const result = {
				id,
				name: file.name,
				text: await file.text(),
			};
			this.remember(result);
			if (handle) this.handles.set(result.id, handle);
			return result;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				return;
			throw error;
		}
	}

	async openFolder(): Promise<ExplorerEntry | undefined> {
		try {
			let id: string = crypto.randomUUID();
			if (this.pickers.showDirectoryPicker) {
				const handle = await this.pickers.showDirectoryPicker();
				if (handle.isSameEntry)
					for (const [knownId, record] of this.storedRoots)
						if (
							record.handle &&
							(await handle.isSameEntry(record.handle))
						) {
							id = knownId;
							break;
						}
				this.directories.set(id, handle);
				const entry: ExplorerEntry = {
					id,
					name: handle.name,
					kind: "directory",
				};
				await this.persistFolder({ version: 1, entry, handle });
				return entry;
			}
			const files = await new Promise<File[]>((resolve) => {
				const input = document.createElement("input");
				input.type = "file";
				input.setAttribute("webkitdirectory", "");
				input.onchange = () => resolve(Array.from(input.files ?? []));
				input.oncancel = () => resolve([]);
				input.click();
			});
			if (!files.length) return;
			this.children.set(id, []);
			for (const file of files) {
				const parts = file.webkitRelativePath.split("/").slice(1);
				let parent: string = id;
				for (let index = 0; index < parts.length; index++) {
					const name = parts[index];
					const childId = `${parent}/${name}`;
					const kind =
						index === parts.length - 1 ? "file" : "directory";
					const siblings = this.children.get(parent) ?? [];
					if (!siblings.some((entry) => entry.id === childId))
						siblings.push({ id: childId, name, kind });
					this.children.set(parent, siblings);
					if (kind === "file") this.imported.set(childId, file);
					parent = childId;
				}
			}
			const entry: ExplorerEntry = {
				id,
				name: files[0].webkitRelativePath.split("/")[0],
				kind: "directory",
			};
			await this.persistFolder({
				version: 1,
				entry,
				children: [...this.children].filter(
					([key]) => key === id || key.startsWith(`${id}/`),
				),
				files: [...this.imported].filter(([key]) =>
					key.startsWith(`${id}/`),
				),
			});
			return entry;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				return;
			throw error;
		}
	}

	async removeRoot(id: string): Promise<void> {
		this.storedRoots.delete(id);
		await writeFolder({
			version: 2,
			folders: [...this.storedRoots.values()],
		});
	}

	async readDirectory(id: string): Promise<ExplorerEntry[]> {
		const handle = this.directories.get(id);
		if (handle && !this.children.has(id)) {
			const children: ExplorerEntry[] = [];
			for await (const child of handle.values()) {
				const childId = `${id}/${child.name}`;
				children.push({
					id: childId,
					name: child.name,
					kind: child.kind,
				});
				if (child.kind === "file") this.handles.set(childId, child);
				else this.directories.set(childId, child);
			}
			this.children.set(id, children);
		}
		return [...(this.children.get(id) ?? [])].sort((a, b) =>
			a.kind === b.kind
				? a.name.localeCompare(b.name)
				: a.kind === "directory"
					? -1
					: 1,
		);
	}

	refresh(): void {
		for (const id of this.directories.keys()) this.children.delete(id);
	}

	private async directory(id: string): Promise<DirectoryHandle> {
		const known = this.directories.get(id);
		if (known) return known;
		for (const [rootId, record] of this.storedRoots) {
			if (!record.handle || !id.startsWith(`${rootId}/`)) continue;
			let handle = record.handle;
			for (const name of id.slice(rootId.length + 1).split("/"))
				handle = await handle.getDirectoryHandle(name);
			this.directories.set(id, handle);
			return handle;
		}
		throw new Error(
			"This folder is an imported snapshot. Reopen it with writable directory access to manage files.",
		);
	}

	async createEntry(
		parentId: string,
		name: string,
		kind: ExplorerEntry["kind"],
	): Promise<ExplorerEntry> {
		if (!name || name === "." || name === ".." || /[/\\\0]/.test(name))
			throw new Error("Enter a single file or folder name.");
		const directory = await this.directory(parentId);
		this.children.delete(parentId);
		if (
			(await this.readDirectory(parentId)).some(
				(entry) => entry.name === name,
			)
		)
			throw new Error("An entry with this name already exists.");
		const entry = { id: `${parentId}/${name}`, name, kind };
		if (kind === "directory")
			this.directories.set(
				entry.id,
				await directory.getDirectoryHandle(name, { create: true }),
			);
		else
			this.handles.set(
				entry.id,
				await directory.getFileHandle(name, { create: true }),
			);
		this.children.delete(parentId);
		return entry;
	}

	async deleteEntry(entry: ExplorerEntry): Promise<void> {
		const split = entry.id.lastIndexOf("/");
		if (split < 0)
			throw new Error("Workspace roots cannot be deleted here.");
		await (await this.directory(entry.id.slice(0, split))).removeEntry(
			entry.name,
			{ recursive: entry.kind === "directory" },
		);
		for (const map of [
			this.handles,
			this.directories,
			this.children,
			this.names,
			this.imported,
		])
			for (const id of map.keys())
				if (id === entry.id || id.startsWith(`${entry.id}/`))
					map.delete(id);
		this.refresh();
	}

	async moveEntry(
		entry: ExplorerEntry,
		parentId: string,
		name: string,
	): Promise<ExplorerEntry> {
		if (!entry.id.includes("/"))
			throw new Error("Workspace roots cannot be renamed or moved here.");
		if (parentId === entry.id || parentId.startsWith(`${entry.id}/`))
			throw new Error("A folder cannot be moved inside itself.");
		if (entry.kind === "directory") {
			const source = await this.directory(entry.id);
			type Tree = {
				directories: { name: string; tree: Tree }[];
				files: { name: string; file: File }[];
			};
			let count = 0,
				bytes = 0;
			const capture = async (
				directory: DirectoryHandle,
			): Promise<Tree> => {
				const tree: Tree = { directories: [], files: [] };
				for await (const child of directory.values()) {
					if (++count > 10000)
						throw new Error(
							"Move exceeds 10,000 entries. Source has not been removed.",
						);
					if (child.kind === "directory")
						tree.directories.push({
							name: child.name,
							tree: await capture(child),
						});
					else {
						const file = await child.getFile();
						bytes += file.size;
						if (bytes > 256 * 1024 * 1024)
							throw new Error(
								"Move exceeds 256 MB. Source has not been removed.",
							);
						tree.files.push({ name: child.name, file });
					}
				}
				tree.directories.sort((a, b) => a.name.localeCompare(b.name));
				tree.files.sort((a, b) => a.name.localeCompare(b.name));
				return tree;
			};
			const signature = (tree: Tree): string =>
				JSON.stringify({
					directories: tree.directories.map((child) => ({
						name: child.name,
						tree: signature(child.tree),
					})),
					files: tree.files.map((child) => ({
						name: child.name,
						size: child.file.size,
						time: child.file.lastModified,
					})),
				});
			const tree = await capture(source);
			const original = signature(tree);
			const target = await this.createEntry(parentId, name, "directory");
			const copy = async (
				tree: Tree,
				directory: DirectoryHandle,
			): Promise<void> => {
				for (const child of tree.directories)
					await copy(
						child.tree,
						await directory.getDirectoryHandle(child.name, {
							create: true,
						}),
					);
				for (const child of tree.files) {
					const writable = await (
						await directory.getFileHandle(child.name, {
							create: true,
						})
					).createWritable();
					await writable.write(child.file);
					await writable.close();
				}
			};
			try {
				await copy(tree, await this.directory(target.id));
				count = 0;
				bytes = 0;
				if (signature(await capture(source)) !== original)
					throw new Error("Source changed during copy.");
			} catch (error) {
				throw new Error(
					`Move stopped; source and partial destination were retained: ${String(error)}`,
				);
			}
			await this.deleteEntry(entry);
			return target;
		}
		const sourceHandle = await this.resolveFileHandle(entry.id);
		if (!sourceHandle)
			throw new Error("Imported files cannot be moved on disk.");
		const source = await sourceHandle.getFile();
		const target = await this.createEntry(parentId, name, "file");
		const targetHandle = await this.resolveFileHandle(target.id);
		if (!targetHandle) throw new Error("Move destination is unavailable.");
		const writable = await targetHandle.createWritable();
		await writable.write(source);
		await writable.close();
		const latest = await sourceHandle.getFile();
		if (
			latest.lastModified !== source.lastModified ||
			latest.size !== source.size
		)
			throw new Error(
				"Source changed during copy. Both files were retained; source was not deleted.",
			);
		await this.deleteEntry(entry);
		return target;
	}

	canWatch(id: string): boolean {
		return (
			this.handles.has(id) ||
			[...this.storedRoots.entries()].some(
				([root, record]) => record.handle && id.startsWith(`${root}/`),
			)
		);
	}

	async readSearchFile(id: string): Promise<TextFile | undefined> {
		const file =
			(await (await this.resolveFileHandle(id))?.getFile()) ??
			this.imported.get(id);
		if (!file || file.size > 4 * 1024 * 1024) return;
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (bytes.includes(0)) return;
		try {
			return {
				id,
				name: file.name,
				text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			};
		} catch {
			return;
		}
	}

	async readTextFile(id: string): Promise<TextFile> {
		const file =
			(await (await this.resolveFileHandle(id))?.getFile()) ??
			this.imported.get(id);
		if (!file) throw new Error("File is no longer available.");
		const result = { id, name: file.name, text: await file.text() };
		this.remember(result);
		return result;
	}

	async saveTextFile(
		id: string,
		text: string,
		options?: { expectedText?: string; overwrite?: boolean },
	): Promise<void> {
		let handle = await this.resolveFileHandle(id);
		if (
			handle &&
			options &&
			!options.overwrite &&
			options.expectedText !== (await (await handle.getFile()).text())
		)
			throw new Error(
				"File changed on disk. Reload or explicitly overwrite the external version.",
			);
		if (!handle) {
			if (!this.pickers.showSaveFilePicker) {
				throw new Error(
					"Saving is unavailable in this browser. Use Download copy.",
				);
			}
			handle = await this.pickers.showSaveFilePicker({
				suggestedName: this.names.get(id) ?? "untitled.txt",
			});
			this.handles.set(id, handle);
		}
		const baseline = await (await handle.getFile()).text();
		const writable = await handle.createWritable();
		try {
			await writable.write(text);
			if ((await (await handle.getFile()).text()) !== baseline)
				throw new Error(
					"File changed while saving. The write was cancelled; reload or retry after resolving the conflict.",
				);
			await writable.close();
		} catch (error) {
			try {
				await writable.abort?.();
			} catch {}
			throw error;
		}
	}

	download(file: TextFile): void {
		const url = URL.createObjectURL(
			new Blob([file.text], { type: "text/plain;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = file.name;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
