import type { DirectoryHandle, FileHandle } from "../browser/fileHost";
import { type NativeFiles, unwrap } from "./bridge";

class DesktopFile implements FileHandle {
	readonly kind = "file" as const;
	constructor(
		private files: NativeFiles,
		readonly id: string,
		readonly name: string,
	) {}
	async getFile() {
		const value = await unwrap(this.files.readBytes(this.id));
		return new File([value.bytes.slice().buffer], value.name, {
			lastModified: value.modified,
		});
	}
	async createWritable() {
		const baseline = await unwrap(this.files.stat(this.id));
		let data = new Uint8Array(),
			closed = false;
		return {
			write: async (value: string | Blob) => {
				if (closed) throw new Error("File writer is closed.");
				data =
					typeof value === "string"
						? new TextEncoder().encode(value)
						: new Uint8Array(await value.arrayBuffer());
			},
			close: async () => {
				if (closed) throw new Error("File writer is closed.");
				await unwrap(
					this.files.writeBytes(this.id, data, baseline.stamp),
				);
				closed = true;
			},
			abort: async () => {
				closed = true;
			},
		};
	}
}
export class DesktopDirectory implements DirectoryHandle {
	readonly kind = "directory" as const;
	constructor(
		private files: NativeFiles,
		readonly id: string,
		readonly name: string,
	) {}
	private child(name: string) {
		if (!name || name === "." || name === ".." || /[/\\\0]/.test(name))
			throw new Error("Invalid entry name.");
		return `${this.id}/${name}`;
	}
	async *values() {
		for (const entry of await unwrap(this.files.readDirectory(this.id)))
			yield entry.kind === "directory"
				? new DesktopDirectory(this.files, entry.id, entry.name)
				: new DesktopFile(this.files, entry.id, entry.name);
	}
	async queryPermission() {
		return (await unwrap(this.files.reconnect(this.id)))
			? ("granted" as const)
			: ("denied" as const);
	}
	async requestPermission() {
		return this.queryPermission();
	}
	private async entry(
		name: string,
		kind: "file" | "directory",
		create = false,
	) {
		const id = this.child(name);
		try {
			const value = await unwrap(this.files.stat(id));
			if (value.kind !== kind)
				throw new DOMException(
					"Entry has a different kind.",
					"TypeMismatchError",
				);
		} catch (error) {
			if (!create || (error as DOMException).name !== "NotFoundError")
				throw error;
			await unwrap(this.files.create(this.id, name, kind));
		}
		return id;
	}
	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		return new DesktopDirectory(
			this.files,
			await this.entry(name, "directory", options?.create),
			name,
		);
	}
	async getFileHandle(name: string, options?: { create?: boolean }) {
		return new DesktopFile(
			this.files,
			await this.entry(name, "file", options?.create),
			name,
		);
	}
	async removeEntry(name: string, options?: { recursive?: boolean }) {
		await unwrap(
			this.files.remove(this.child(name), options?.recursive ?? false),
		);
	}
}
