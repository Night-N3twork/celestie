import type { FSBackend } from "@nightnetwork/dusk";
import type { DirectoryHandle, FileHandle } from "../browser/fileHost";

type Mutation = Parameters<Parameters<FSBackend["subscribe"]>[0]>[0];
const fail = (code: string, message: string) =>
	Object.assign(new Error(message), { code });
export class DirectoryBackend implements FSBackend {
	private listeners = new Set<(event: Mutation) => void>();
	private handles = new Map<number, { path: string; flags: number }>();
	private nextHandle = 1;
	constructor(private root: DirectoryHandle) {}
	private parts(path: string) {
		const parts = path.split("/").filter(Boolean);
		if (
			parts.some(
				(part) => part === ".." || part === "." || part.includes("\0"),
			)
		)
			throw fail("EINVAL", "Invalid workspace path.");
		return parts;
	}
	private async directory(path: string, create = false) {
		let dir = this.root;
		for (const name of this.parts(path))
			dir = await dir.getDirectoryHandle(name, { create });
		return dir;
	}
	private async parent(path: string) {
		const parts = this.parts(path),
			name = parts.pop();
		if (!name) throw fail("EPERM", "Cannot modify the workspace root.");
		return { dir: await this.directory(parts.join("/")), name };
	}
	private async file(path: string, create = false): Promise<FileHandle> {
		const { dir, name } = await this.parent(path);
		return dir.getFileHandle(name, { create });
	}
	private emit(type: Mutation["type"], path: string, previousPath?: string) {
		for (const listener of this.listeners)
			listener({ type, path, previousPath });
	}
	subscribe(listener: (event: Mutation) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	async readFile(path: string) {
		return new TextDecoder().decode(await this.readFileBytes(path));
	}
	async readFileBytes(path: string) {
		const file = await (await this.file(path)).getFile();
		const buffer: ArrayBuffer = await file.arrayBuffer();
		return new Uint8Array(buffer);
	}
	async writeFile(path: string, text: string) {
		await this.writeFileBytes(path, new TextEncoder().encode(text));
	}
	async writeFileBytes(path: string, data: Uint8Array) {
		const handle = await this.file(path, true),
			writer = await handle.createWritable();
		try {
			await writer.write(new Blob([data.slice().buffer]));
			await writer.close();
			this.emit("write", path);
		} catch (error) {
			await writer.abort?.();
			throw error;
		}
	}
	async readdir(path: string) {
		const names: string[] = [];
		for await (const child of (await this.directory(path)).values())
			names.push(child.name);
		return names;
	}
	async mkdir(path: string, options?: { recursive?: boolean }) {
		if (options?.recursive) await this.directory(path, true);
		else {
			const { dir, name } = await this.parent(path);
			if (await this.exists(path))
				throw fail("EEXIST", "Directory already exists.");
			await dir.getDirectoryHandle(name, { create: true });
		}
		this.emit("mkdir", path);
	}
	async rm(path: string, options?: { recursive?: boolean }) {
		const { dir, name } = await this.parent(path);
		await dir.removeEntry(name, { recursive: options?.recursive });
		this.emit("rm", path);
	}
	async exists(path: string) {
		try {
			await this.stat(path);
			return true;
		} catch (error) {
			if (
				(error as DOMException).name === "NotFoundError" ||
				(error as { code?: string }).code === "ENOENT"
			)
				return false;
			throw error;
		}
	}
	async stat(path: string) {
		let file: File | undefined;
		try {
			file = await (await this.file(path)).getFile();
		} catch (error) {
			if (
				!this.parts(path).length ||
				["TypeMismatchError", "NotFoundError"].includes(
					(error as DOMException).name,
				)
			)
				await this.directory(path);
			else throw error;
		}
		const time = file?.lastModified ?? 0;
		return {
			isFile: !!file,
			isDirectory: !file,
			size: file?.size ?? 0,
			mtimeMs: time,
			ctimeMs: time,
			atimeMs: time,
			birthtimeMs: time,
		};
	}
	async lstat(path: string) {
		return this.stat(path);
	}
	async rename(from: string, to: string) {
		if (from === to) return;
		if (to.startsWith(`${from}/`))
			throw fail("EINVAL", "Cannot move a folder inside itself.");
		if (await this.exists(to)) {
			if (
				!(await this.stat(from)).isFile ||
				!(await this.stat(to)).isFile
			)
				throw fail("EEXIST", "Destination already exists.");
		}
		const copy = async (source: string, target: string): Promise<void> => {
			const before = await this.stat(source);
			if (before.isDirectory) {
				await this.mkdir(target);
				for (const name of await this.readdir(source))
					await copy(`${source}/${name}`, `${target}/${name}`);
			} else {
				await this.writeFileBytes(
					target,
					await this.readFileBytes(source),
				);
				const after = await this.stat(source);
				if (
					after.mtimeMs !== before.mtimeMs ||
					after.size !== before.size
				)
					throw fail(
						"EBUSY",
						"Source changed during move; both copies were retained.",
					);
			}
		};
		await copy(from, to);
		await this.rm(from, { recursive: true });
		for (const handle of this.handles.values())
			if (handle.path === from || handle.path.startsWith(`${from}/`))
				handle.path = to + handle.path.slice(from.length);
		this.emit("rename", to, from);
	}
	private handle(id: number) {
		const record = this.handles.get(id);
		if (!record) throw fail("EBADF", "File handle is closed.");
		return record;
	}
	async openHandle(path: string, flags: number) {
		const exists = await this.exists(path);
		if (exists && flags & 64 && flags & 128)
			throw fail("EEXIST", "File already exists.");
		if (!exists) {
			if (!(flags & 64)) throw fail("ENOENT", "File does not exist.");
			await this.writeFileBytes(path, new Uint8Array());
		}
		if (flags & 512 && flags & 3)
			await this.writeFileBytes(path, new Uint8Array());
		const info = await this.stat(path);
		if (!info.isFile)
			throw fail("EISDIR", "Cannot open a directory as a file.");
		const handle = this.nextHandle++;
		this.handles.set(handle, { path, flags });
		return { handle, size: info.size, appendOnly: !!(flags & 1024) };
	}
	async readHandle(id: number, length: number, position: number) {
		const record = this.handle(id);
		if ((record.flags & 3) === 1)
			throw fail("EBADF", "File is not open for reading.");
		const data = await this.readFileBytes(record.path),
			bytes = data.slice(position, position + length);
		return { bytes, bytesRead: bytes.length };
	}
	async writeHandle(id: number, data: Uint8Array, position: number) {
		const record = this.handle(id);
		if (!(record.flags & 3)) throw fail("EBADF", "File is read only.");
		const before = await this.readFileBytes(record.path),
			offset = record.flags & 1024 ? before.length : position,
			result = new Uint8Array(
				Math.max(before.length, offset + data.length),
			);
		result.set(before);
		result.set(data, offset);
		await this.writeFileBytes(record.path, result);
		return { bytesWritten: data.length };
	}
	async closeHandle(id: number) {
		this.handle(id);
		this.handles.delete(id);
	}
	async fstatHandle(id: number) {
		return this.stat(this.handle(id).path);
	}
	async ftruncateHandle(id: number, length: number) {
		const record = this.handle(id);
		if (!(record.flags & 3)) throw fail("EBADF", "File is read only.");
		const data = await this.readFileBytes(record.path),
			result = new Uint8Array(length);
		result.set(data.subarray(0, length));
		await this.writeFileBytes(record.path, result);
	}
	async fsyncHandle(id: number) {
		this.handle(id);
	}
}
