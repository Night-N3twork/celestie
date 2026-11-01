import type { LanguageEvent, OpenDocument } from "../../language/lsp";
import type { ExplorerEntry, TextFile } from "../host";
import type { FileChange, ProcessOptions } from "../services";
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
export type RuntimeEvent =
	| { id: string; type: "output"; stream: "stdout" | "stderr"; text: string }
	| { id: string; type: "exit"; code: number };
export interface NativeRuntime {
	spawn(options: ProcessOptions): Promise<Result<string>>;
	runScript(cwd: string, name: string): Promise<Result<string>>;
	open(options: {
		cwd: string;
		cols: number;
		rows: number;
	}): Promise<Result<string>>;
	listen(id: string): Promise<Result<void>>;
	write(id: string, data: string): Promise<Result<void>>;
	resize(id: string, cols: number, rows: number): Promise<Result<void>>;
	stop(id: string): Promise<Result<void>>;
}
export interface DesktopBridge {
	window: {
		theme(
			color: string,
			symbolColor: string,
			height: number,
		): Promise<Result<void>>;
	};
	languages: {
		sync(documents: OpenDocument[]): Promise<Result<void>>;
		request(
			id: string,
			method: string,
			params?: Record<string, unknown>,
		): Promise<Result<unknown>>;
		fileId(uri: string): Promise<Result<string>>;
		restart(): Promise<Result<void>>;
	};
	onDiagnostics(listener: (event: LanguageEvent) => void): () => void;
	kind: "electron";
	platform: string;
	files: NativeFiles;
	runtime: NativeRuntime;
	onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
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
