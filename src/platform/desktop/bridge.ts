import type { ExplorerEntry, TextFile } from "../host";
import type { FileChange } from "../services";
export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; error: { message: string; code?: string } };
export interface NativeStat {
	kind: ExplorerEntry["kind"];
	size: number;
	modified: number;
	stamp: string;
}
export interface NativeFiles {
	openFolder(): Promise<Result<ExplorerEntry | undefined>>;
	openFile(): Promise<Result<TextFile | undefined>>;
	restore(): Promise<
		Result<{
			folders: { entry: ExplorerEntry; accessible: boolean }[];
			files: string[];
		}>
	>;
	reconnect(id: string): Promise<Result<boolean>>;
	removeRoot(id: string): Promise<Result<void>>;
	readDirectory(id: string): Promise<Result<ExplorerEntry[]>>;
	readBytes(id: string): Promise<
		Result<{
			id: string;
			bytes: Uint8Array;
			name: string;
			modified: number;
		}>
	>;
	stat(id: string): Promise<Result<NativeStat>>;
	saveText(
		id: string,
		text: string,
		name: string,
		options?: { expectedText?: string; overwrite?: boolean },
	): Promise<Result<{ id: string; name: string }>>;
	writeBytes(
		id: string,
		bytes: Uint8Array,
		stamp: string,
	): Promise<Result<void>>;
	create(
		parent: string,
		name: string,
		kind: ExplorerEntry["kind"],
	): Promise<Result<ExplorerEntry>>;
	remove(id: string, recursive: boolean): Promise<Result<void>>;
	move(
		id: string,
		parent: string,
		name: string,
	): Promise<Result<ExplorerEntry>>;
	exportText(file: TextFile): Promise<Result<void>>;
}
export interface DesktopBridge {
	kind: "electron";
	platform: string;
	files: NativeFiles;
	onFileChange(listener: (change: FileChange) => void): () => void;
}
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
	const result = await request;
	if (result.ok) return result.value;
	if (result.error.code === "ENOENT")
		throw new DOMException(result.error.message, "NotFoundError");
	throw Object.assign(new Error(result.error.message), {
		code: result.error.code,
	});
}
