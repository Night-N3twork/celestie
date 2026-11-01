import { BrowserFileHost } from "../browser/fileHost";
import type { ExplorerEntry, TextFile } from "../host";
import { duskEnvironment, duskId, duskPath } from "./environment";
import { workspaceRuntime } from "./workspaceRuntime";

const key = "celestie.dusk.roots.v1";
export class WorkspaceFileHost extends BrowserFileHost {
	runtimeRoot = workspaceRuntime((id) => this.nativeDirectory(id));
	private webRoots: string[] = [];
	override async restoreFolders() {
		const local = await super.restoreFolders();
		const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		this.webRoots = Array.isArray(saved)
			? saved.filter(
					(p): p is string =>
						typeof p === "string" &&
						/^\/home\/user\/projects\/[\w.-]+$/.test(p) &&
						!p.endsWith("/..") &&
						!p.endsWith("/."),
				)
			: [];
		return [
			...local,
			...this.webRoots.map((path) => ({
				entry: {
					id: duskId(path),
					name: path.split("/").at(-1) ?? "project",
					kind: "directory" as const,
				},
				accessible: true,
			})),
		];
	}
	override async removeRoot(id: string) {
		if (!id.startsWith("dusk:")) return super.removeRoot(id);
		this.webRoots = this.webRoots.filter((path) => duskId(path) !== id);
		localStorage.setItem(key, JSON.stringify(this.webRoots));
	}
	override async readDirectory(id: string): Promise<ExplorerEntry[]> {
		if (!id.startsWith("dusk:")) return super.readDirectory(id);
		const path = duskPath(id),
			{ fs } = await duskEnvironment();
		const entries = await Promise.all(
			(await fs.readdir(path)).map(async (name) => ({
				id: duskId(`${path}/${name}`),
				name,
				kind: (await fs.stat(`${path}/${name}`)).isDirectory
					? ("directory" as const)
					: ("file" as const),
			})),
		);
		return entries.sort((a, b) =>
			a.kind === b.kind
				? a.name.localeCompare(b.name)
				: a.kind === "directory"
					? -1
					: 1,
		);
	}
	override async readTextFile(id: string): Promise<TextFile> {
		if (!id.startsWith("dusk:")) return super.readTextFile(id);
		try {
			return {
				id,
				name: id.split("/").at(-1) ?? "file",
				text: await (await duskEnvironment()).fs.readFile(duskPath(id)),
			};
		} catch (error) {
			if ((error as { code?: string })?.code === "ENOENT")
				throw new DOMException(
					"File was removed from the web project.",
					"NotFoundError",
				);
			throw error;
		}
	}
	override async readSearchFile(id: string) {
		if (!id.startsWith("dusk:")) return super.readSearchFile(id);
		const { fs } = await duskEnvironment(),
			path = duskPath(id);
		if ((await fs.stat(path)).size > 4 * 1024 * 1024) return;
		const bytes = await fs.readFileBytes(path);
		if (bytes.includes(0)) return;
		try {
			return {
				id,
				name: path.split("/").at(-1) ?? "project",
				text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			};
		} catch {
			return;
		}
	}
	override async saveTextFile(
		id: string,
		text: string,
		options?: { expectedText?: string; overwrite?: boolean },
	) {
		if (!id.startsWith("dusk:"))
			return super.saveTextFile(id, text, options);
		const { fs } = await duskEnvironment(),
			path = duskPath(id);
		if (
			options &&
			!options.overwrite &&
			(await fs.exists(path)) &&
			(await fs.readFile(path)) !== options.expectedText
		)
			throw new Error(
				"File changed in Dusk. Reload or explicitly overwrite the external version.",
			);
		await fs.writeFile(path, text);
	}
	override canWatch(id: string) {
		return id.startsWith("dusk:") || super.canWatch(id);
	}
	override async createEntry(
		parentId: string,
		name: string,
		kind: ExplorerEntry["kind"],
	) {
		if (!parentId.startsWith("dusk:"))
			return super.createEntry(parentId, name, kind);
		this.validateName(name);
		const path = `${duskPath(parentId)}/${name}`,
			{ fs } = await duskEnvironment();
		if (await fs.exists(path))
			throw new Error("An entry with this name already exists.");
		if (kind === "directory") await fs.mkdir(path);
		else await fs.writeFile(path, "");
		return { id: duskId(path), name, kind };
	}
	override async deleteEntry(entry: ExplorerEntry) {
		if (!entry.id.startsWith("dusk:")) return super.deleteEntry(entry);
		const path = duskPath(entry.id);
		if (this.webRoots.includes(path))
			throw new Error("Remove workspace roots through the explorer.");
		await (await duskEnvironment()).fs.rm(path, {
			recursive: entry.kind === "directory",
		});
	}
	override async moveEntry(
		entry: ExplorerEntry,
		parentId: string,
		name: string,
	) {
		if (!entry.id.startsWith("dusk:") && !parentId.startsWith("dusk:"))
			return super.moveEntry(entry, parentId, name);
		if (!entry.id.startsWith("dusk:") || !parentId.startsWith("dusk:"))
			throw new Error(
				"Moving between local and web projects is not supported.",
			);
		this.validateName(name);
		const source = duskPath(entry.id),
			target = `${duskPath(parentId)}/${name}`,
			{ fs } = await duskEnvironment();
		if (this.webRoots.includes(source) || target.startsWith(`${source}/`))
			throw new Error("Invalid move destination.");
		if (await fs.exists(target))
			throw new Error("Destination already exists.");
		await fs.rename(source, target);
		return { id: duskId(target), name, kind: entry.kind };
	}
	override async readFileBytes(id: string): Promise<Uint8Array> {
		if (!id.startsWith("dusk:")) return super.readFileBytes(id);
		return (await duskEnvironment()).fs.readFileBytes(duskPath(id));
	}
	private validateName(name: string) {
		if (!name || name === "." || name === ".." || /[/\\\0]/.test(name))
			throw new Error("Enter a single file or folder name.");
	}
}
