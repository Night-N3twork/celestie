import type { Analysis, Token } from "../api/languages";
import type {
	LineTokenizationResult,
	TokenizationContext,
	WorkerTokenizer,
} from "../api/tokenization";
import { validateTokens } from "../languages/token-spans";
import { analyzeDocument } from "./document-language";
import type { LanguageDocument } from "./language-protocol";

interface CachedLine extends LineTokenizationResult {
	readonly text: string;
	readonly input: string;
}
const modules = new Map<string, Promise<WorkerTokenizer>>();
const documents = new Map<string, { key: string; lines: CachedLine[] }>();
const active = new Map<string, { key: string; tokenizer: WorkerTokenizer }>();
export function disposeTokenizer(id: string): void {
	documents.delete(id);
	const entry = active.get(id);
	active.delete(id);
	try {
		entry?.tokenizer.disposeDocument?.(id);
	} catch (error) {
		console.warn("Tokenizer cleanup failed", error);
	}
}
function load(url: string): Promise<WorkerTokenizer> {
	let module = modules.get(url);
	if (!module) {
		module = import(url).then((module) => {
			const tokenizer = module.default as WorkerTokenizer;
			if (
				!tokenizer ||
				(tokenizer.initialState !== undefined &&
					typeof tokenizer.initialState !== "string") ||
				(!tokenizer.tokenize &&
					!tokenizer.tokenizeLine &&
					!tokenizer.semanticTokens)
			)
				throw new TypeError(
					"Tokenizer module must export a tokenizer as default.",
				);
			return tokenizer;
		});
		if (modules.size >= 32) modules.clear();
		modules.set(url, module);
		module.catch(() => {
			if (modules.get(url) === module) modules.delete(url);
		});
	}
	return module;
}
function lineTokens(
	document: LanguageDocument,
	tokenizer: WorkerTokenizer,
	signal: AbortSignal,
): Token[] {
	const key = `${document.uri}:${document.language}:${JSON.stringify(document.profile.tokenizer)}`;
	const cached = documents.get(document.id),
		old = cached?.key === key ? cached.lines : [];
	const lines: CachedLine[] = [],
		tokens: Token[] = [];
	let state = tokenizer.initialState ?? "",
		offset = 0;
	for (const [index, text] of document.text.split("\n").entries()) {
		signal.throwIfAborted();
		let line = old[index];
		if (!line || line.text !== text || line.input !== state) {
			const result = tokenizer.tokenizeLine?.(text, state, {
				documentId: document.id,
				uri: document.uri,
				language: document.language,
				lineNumber: index + 1,
				signal,
			});
			if (
				!result ||
				typeof result.state !== "string" ||
				result.state.length > 100000
			)
				throw new TypeError(
					"Line tokenizers must return tokens and a bounded string state.",
				);
			line = {
				text,
				input: state,
				state: result.state,
				tokens: validateTokens(result.tokens, text.length),
			};
		}
		lines.push(line);
		state = line.state;
		for (const token of line.tokens) {
			if (tokens.length >= 150000)
				throw new RangeError(
					"Token output exceeds the supported limit.",
				);
			tokens.push({
				...token,
				from: offset + token.from,
				to: offset + token.to,
			});
		}
		offset += text.length + 1;
	}
	documents.set(document.id, { key, lines });
	return tokens;
}
export async function analyzeWithTokenizer(
	document: LanguageDocument,
	signal: AbortSignal,
): Promise<Analysis> {
	const registration = document.profile.tokenizer;
	if (!registration || document.text.length > 600000) {
		disposeTokenizer(document.id);
		return analyzeDocument(document);
	}
	try {
		const tokenizer = await load(registration.moduleUrl);
		signal.throwIfAborted();
		const key = `${registration.moduleUrl}:${registration.version}:${document.language}`;
		if (active.get(document.id)?.key !== key) {
			disposeTokenizer(document.id);
			active.set(document.id, { key, tokenizer });
		}
		const context: TokenizationContext = {
			documentId: document.id,
			uri: document.uri,
			language: document.language,
			text: document.text,
			version: document.version,
			signal,
		};
		const tokens = tokenizer.tokenizeLine
			? lineTokens(document, tokenizer, signal)
			: tokenizer.tokenize
				? validateTokens(
						await tokenizer.tokenize(context),
						document.text.length,
					)
				: undefined;
		const semanticTokens = tokenizer.semanticTokens
			? validateTokens(
					await tokenizer.semanticTokens(context),
					document.text.length,
				)
			: [];
		signal.throwIfAborted();
		const baseline = analyzeDocument(document, tokens);
		return {
			...baseline,
			tokens: tokens ?? baseline.tokens,
			semanticTokens,
		};
	} catch (error) {
		if (signal.aborted) throw error;
		disposeTokenizer(document.id);
		const baseline = analyzeDocument(document);
		return {
			...baseline,
			diagnostics: [
				...baseline.diagnostics,
				{
					from: 0,
					to: Math.min(1, document.text.length),
					severity: "warning",
					source: "Editor",
					message: `Custom tokenizer failed; using built-in highlighting. ${error instanceof Error ? error.message : String(error)}`,
				},
			],
		};
	}
}
