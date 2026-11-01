import { workspaceRuntime } from "../dusk/workspaceRuntime";
import type { ExplorerEntry, TextFile } from "../host";
import type { FileChange, WorkspaceHost } from "../services";
import { type DesktopBridge, unwrap } from "./bridge";
import { DesktopDirectory } from "./directory";
export class DesktopFileHost implements WorkspaceHost {
	private displayNames = new Map<string, string>();
	private authorized = new Set<string>();
	constructor(private bridge: DesktopBridge) {}
	folderPersistenceError = "";
	runtimeRoot = workspaceRuntime((id) => this.nativeDirectory(id));
	private saved = new Map<string, Pick<TextFile, "id" | "name">>();
	savedLocation(id: string) {
		return this.saved.get(id);
	}

	remember(file: Pick<TextFile, "id" | "name">) {
		this.displayNames.set(file.id, file.name);
	}
	async openFolder() {
		const entry = await unwrap(this.bridge.files.openFolder());
		if (entry) this.authorized.add(entry.id);
		return entry;
	}
	async openTextFile() {
		const file = await unwrap(this.bridge.files.openFile());
		if (file) {
			this.authorized.add(file.id.split("/")[0]);
			this.remember(file);
		}
		return file;
	}
	async restoreFolders() {
		const state = await unwrap(this.bridge.files.restore());
		this.authorized = new Set(state.files);
		return state.folders;
	}
	async reconnectFolder(id: string) {
		return unwrap(this.bridge.files.reconnect(id));
	}
	async removeRoot(id: string) {
		await unwrap(this.bridge.files.removeRoot(id));
		this.authorized.delete(id);
	}
	async readDirectory(id: string) {
		return unwrap(this.bridge.files.readDirectory(id));
	}
	async readFileBytes(id: string) {
		return (await unwrap(this.bridge.files.readBytes(id))).bytes;
	}
	async readTextFile(id: string): Promise<TextFile> {
		const file = await unwrap(this.bridge.files.readBytes(id));
		const result = {
			id: file.id,
			name: file.name,
			text: new TextDecoder().decode(file.bytes),
		};
		this.remember(result);
		return result;
	}
	async readSearchFile(id: string) {
		const info = await unwrap(this.bridge.files.stat(id));
		if (info.size > 4 * 1024 * 1024) return;
		const file = await unwrap(this.bridge.files.readBytes(id));
		if (file.bytes.includes(0)) return;
		try {
			return {
				id,
				name: file.name,
				text: new TextDecoder("utf-8", { fatal: true }).decode(
					file.bytes,
				),
			};
		} catch {
			return;
		}
	}
	async saveTextFile(
		id: string,
		text: string,
		options?: { expectedText?: string; overwrite?: boolean },
	) {
		const saved = await unwrap(
			this.bridge.files.saveText(
				id,
				text,
				this.displayNames.get(id) ?? "untitled.txt",
				options,
			),
		);
		this.displayNames.set(id, saved.name);
		this.saved.set(id, saved);
		this.authorized.add(saved.id.split("/")[0]);
		this.authorized.add(id.split("/")[0]);
	}
	async nativeDirectory(id: string) {
		const info = await unwrap(this.bridge.files.stat(id));
		if (info.kind !== "directory") throw new Error("Select a folder.");
		return new DesktopDirectory(
			this.bridge.files,
			id,
			id.split("/").at(-1) ?? "workspace",
		);
	}
	async createEntry(
		parent: string,
		name: string,
		kind: ExplorerEntry["kind"],
	) {
		return unwrap(this.bridge.files.create(parent, name, kind));
	}
	async deleteEntry(entry: ExplorerEntry) {
		await unwrap(
			this.bridge.files.remove(entry.id, entry.kind === "directory"),
		);
	}
	async moveEntry(entry: ExplorerEntry, parent: string, name: string) {
		return unwrap(this.bridge.files.move(entry.id, parent, name));
	}
	refresh() {}
	canWatch(id: string) {
		return this.authorized.has(id.split("/")[0]);
	}
	download(file: TextFile) {
		return unwrap(this.bridge.files.exportText(file));
	}
	watch(listener: (change: FileChange) => void) {
		return this.bridge.onFileChange(listener);
	}
}
