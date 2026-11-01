import type { LanguageHost } from "../language/lsp";
import type { ExplorerEntry, FileHost, TextFile } from "./host";

export interface FileChange {
	id: string;
	type: "changed" | "removed" | "error";
	message?: string;
}
export interface WorkspaceHost extends FileHost {
	folderPersistenceError: string;
	remember(file: Pick<TextFile, "id" | "name">): void;
	openFolder(): Promise<ExplorerEntry | undefined>;
	restoreFolders(): Promise<{ entry: ExplorerEntry; accessible: boolean }[]>;
	reconnectFolder(id: string): Promise<boolean>;
	removeRoot(id: string): Promise<void>;
	readDirectory(id: string): Promise<ExplorerEntry[]>;
	readTextFile(id: string): Promise<TextFile>;
	readSearchFile(id: string): Promise<TextFile | undefined>;
	readFileBytes(id: string): Promise<Uint8Array>;
	createEntry(
		parent: string,
		name: string,
		kind: ExplorerEntry["kind"],
	): Promise<ExplorerEntry>;
	deleteEntry(entry: ExplorerEntry): Promise<void>;
	moveEntry(
		entry: ExplorerEntry,
		parent: string,
		name: string,
	): Promise<ExplorerEntry>;
	refresh(): void;
	canWatch(id: string): boolean;
	runtimeRoot(entry: ExplorerEntry): Promise<string>;
	download(file: TextFile): void | Promise<void>;
	watch?(listener: (change: FileChange) => void): () => void;
}
export interface ProcessOptions {
	cwd: string;
	command: string;
	args: readonly string[];
	env?: Record<string, string>;
}
export interface RunningProcess {
	id: string;
	exit: Promise<number>;
	onOutput(
		listener: (data: { stream: "stdout" | "stderr"; text: string }) => void,
	): () => void;
	stop(): Promise<void>;
}
export interface ProcessHost {
	spawn(options: ProcessOptions): Promise<RunningProcess>;
	runScript(cwd: string, name: string): Promise<RunningProcess>;
}
export interface TerminalSession {
	id: string;
	exit: Promise<number>;
	write(data: string): Promise<void>;
	resize(cols: number, rows: number): Promise<void>;
	onData(listener: (data: string) => void): () => void;
	close(): Promise<void>;
}
export interface TerminalHost {
	open(options: {
		cwd: string;
		cols: number;
		rows: number;
	}): Promise<TerminalSession>;
}
export interface Platform {
	languages?: LanguageHost;
	kind: "browser" | "desktop";
	files: WorkspaceHost;
	processes?: ProcessHost;
	terminals?: TerminalHost;
}
