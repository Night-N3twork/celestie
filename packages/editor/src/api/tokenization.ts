import type { Token } from "./languages";
import type { Disposable } from "./types";

export interface TokenizationContext {
	readonly documentId: string;
	readonly uri: string;
	readonly language: string;
	readonly text: string;
	readonly version: number;
	readonly signal: AbortSignal;
}
export interface LineTokenizationResult {
	readonly tokens: readonly Token[];
	readonly state: string;
}
export interface WorkerTokenizer {
	readonly initialState?: string;
	tokenizeLine?(
		line: string,
		state: string,
		context: {
			readonly documentId: string;
			readonly uri: string;
			readonly language: string;
			readonly lineNumber: number;
			readonly signal: AbortSignal;
		},
	): LineTokenizationResult;
	tokenize?(
		context: TokenizationContext,
	): readonly Token[] | Promise<readonly Token[]>;
	semanticTokens?(
		context: TokenizationContext,
	): readonly Token[] | Promise<readonly Token[]>;
	disposeDocument?(documentId: string): void;
}
export interface TokenizerRegistration {
	readonly moduleUrl: string;
}
const entries: {
	languages: readonly string[];
	moduleUrl: string;
	version: number;
}[] = [];
const listeners = new Set<() => void>();
let version = 0;
function changed(): void {
	for (const listener of listeners) listener();
}
export function registerLanguageTokenizer(
	languages: string | readonly string[],
	registration: TokenizerRegistration,
): Disposable {
	const ids = typeof languages === "string" ? [languages] : [...languages];
	if (!ids.length || ids.some((id) => !id) || !registration.moduleUrl)
		throw new TypeError("Tokenizer languages and module URL are required.");
	const moduleUrl = new URL(
		registration.moduleUrl,
		typeof document === "undefined" ? undefined : document.baseURI,
	).href;
	const entry = { languages: ids, moduleUrl, version: ++version };
	entries.push(entry);
	changed();
	return {
		dispose() {
			const index = entries.indexOf(entry);
			if (index < 0) return;
			entries.splice(index, 1);
			changed();
		},
	};
}
export function languageTokenizer(
	language: string,
): { moduleUrl: string; version: number } | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (
			entry &&
			(entry.languages.includes(language) ||
				entry.languages.includes("*"))
		)
			return { moduleUrl: entry.moduleUrl, version: entry.version };
	}
	return undefined;
}
export function onDidChangeTokenizers(listener: () => void): Disposable {
	listeners.add(listener);
	return {
		dispose() {
			listeners.delete(listener);
		},
	};
}
