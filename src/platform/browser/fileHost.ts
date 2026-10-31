import type { ExplorerEntry, FileHost, TextFile } from "../host";
import { readFolder, writeFolder } from "./folderStorage";

interface FileHandle {
	readonly kind: "file";
	readonly name: string;
	isSameEntry?(other: FileHandle): Promise<boolean>;
	getFile(): Promise<File>;
	createWritable(): Promise<{
		write(text: string): Promise<void>;
		close(): Promise<void>;
	}>;
}
interface DirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	values(): AsyncIterable<FileHandle | DirectoryHandle>;
	queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
	requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
	getDirectoryHandle(name: string): Promise<DirectoryHandle>;
	getFileHandle(name: string): Promise<FileHandle>;
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
	folderPersistenceError = "";
	private async persistFolder(folder: StoredFolder): Promise<void> {
		try {
			await writeFolder(folder);
			this.folderPersistenceError = "";
		} catch {
			this.folderPersistenceError = "Folder could not be saved.";
		}
	}

	async restoreFolder(): Promise<
		{ entry: ExplorerEntry; accessible: boolean } | undefined
	> {
		const stored = await readFolder<StoredFolder>();
		if (!stored) return;
		if (
			stored.version !== 1 ||
			stored.entry?.kind !== "directory" ||
			typeof stored.entry.id !== "string" ||
			typeof stored.entry.name !== "string"
		)
			throw new Error("Invalid saved folder");
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
		this.children = new Map(stored.children ?? []);
		this.imported = new Map(stored.files ?? []);
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
			const id = crypto.randomUUID();
			if (this.pickers.showDirectoryPicker) {
				const handle = await this.pickers.showDirectoryPicker();
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

	async readTextFile(id: string): Promise<TextFile> {
		const file =
			(await (await this.resolveFileHandle(id))?.getFile()) ??
			this.imported.get(id);
		if (!file) throw new Error("File is no longer available.");
		const result = { id, name: file.name, text: await file.text() };
		this.remember(result);
		return result;
	}

	async saveTextFile(id: string, text: string): Promise<void> {
		let handle = await this.resolveFileHandle(id);
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
		const writable = await handle.createWritable();
		await writable.write(text);
		await writable.close();
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
