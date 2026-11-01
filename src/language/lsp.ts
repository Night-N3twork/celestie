import type {
	Diagnostic,
	Position,
	Range,
} from "vscode-languageserver-protocol";

export interface OpenDocument {
	saved?: boolean;
	id: string;
	name: string;
	text: string;
	version: number;
}
export interface LanguageEvent {
	id: string;
	text: string;
	diagnostics: Diagnostic[];
}
export interface LanguageHost {
	sync(documents: OpenDocument[]): Promise<void>;
	request<T>(
		id: string,
		method: string,
		params?: Record<string, unknown>,
	): Promise<T>;
	onDiagnostics(listener: (event: LanguageEvent) => void): () => void;
	fileId(uri: string): Promise<string>;
	restart(): Promise<void>;
}
export function languageId(name: string) {
	const extension = name.split(".").at(-1)?.toLowerCase();
	return (
		{
			ts: "typescript",
			tsx: "typescriptreact",
			mts: "typescript",
			cts: "typescript",
			js: "javascript",
			jsx: "javascriptreact",
			mjs: "javascript",
			cjs: "javascript",
			html: "html",
			htm: "html",
			css: "css",
			scss: "scss",
			less: "less",
			json: "json",
			jsonc: "jsonc",
		} as Record<string, string>
	)[extension ?? ""];
}
export function positionAt(text: string, offset: number): Position {
	let line = 0,
		start = 0;
	for (let i = 0; i < Math.min(offset, text.length); i++) {
		if (text[i] === "\r" || text[i] === "\n") {
			if (text[i] === "\r" && text[i + 1] === "\n") i++;
			line++;
			start = i + 1;
		}
	}
	return { line, character: Math.max(0, offset - start) };
}
export function offsetAt(text: string, position: Position): number {
	let line = 0,
		start = 0;
	for (let i = 0; i < text.length; i++) {
		if (line === position.line) {
			const end = text.slice(i).search(/[\r\n]/);
			return Math.min(
				start + position.character,
				end < 0 ? text.length : i + end,
			);
		}
		if (text[i] === "\r" || text[i] === "\n") {
			if (text[i] === "\r" && text[i + 1] === "\n") i++;
			line++;
			start = i + 1;
		}
	}
	return text.length;
}
export function offsets(text: string, range: Range) {
	return { from: offsetAt(text, range.start), to: offsetAt(text, range.end) };
}
