import type { Token } from "../api/languages";
import {
	disposeTokens,
	tokenizeDocument,
} from "../languages/incremental-tokenizer";
import type {
	EmbeddedLanguage,
	LanguageDocument,
	LanguageProfile,
} from "./language-protocol";
import { hasGrammar, Prism } from "./syntax-grammars";

const cache = new Map<string, { text: string; key: string; tokens: Token[] }>();
const kinds: Readonly<Record<string, string>> = {
	comment: "comment",
	prolog: "comment",
	doctype: "comment",
	cdata: "string",
	keyword: "keyword",
	boolean: "keyword",
	important: "keyword",
	atrule: "keyword",
	string: "string",
	char: "string",
	regex: "string",
	"attr-value": "string",
	url: "string",
	number: "number",
	constant: "number",
	function: "function",
	"function-name": "function",
	"class-name": "type",
	builtin: "type",
	property: "type",
	"attr-name": "type",
	tag: "type",
	selector: "type",
	variable: "variable",
	symbol: "type",
	title: "keyword",
	bold: "keyword",
	italic: "string",
	inserted: "string",
	deleted: "comment",
	coord: "keyword",
};

let embedded = new Map<string, string>();
let embeddedVersion = 0;
export function setEmbeddedLanguages(
	languages: readonly EmbeddedLanguage[],
): void {
	embedded = new Map();
	for (const language of languages)
		for (const name of language.names)
			if (!embedded.has(name)) embedded.set(name, language.grammar);
	embeddedVersion++;
}

function fenceGrammar(info: string): string | undefined {
	const word = info
		.trim()
		.replace(/^\{?\.?/, "")
		.split(/[\s,{}]/)[0]
		?.toLowerCase();
	if (!word) return undefined;
	const name = embedded.get(word) ?? word;
	return hasGrammar(name) ? name : undefined;
}

function tokenize(code: string, name: string): Prism.TokenStream {
	const grammar = Prism.languages[name];
	if (!grammar) return code;
	const env: Prism.hooks.TokenizeEnvironment = {
		code,
		grammar,
		language: name,
	};
	Prism.hooks.run("before-tokenize", env);
	env.tokens = Prism.tokenize(env.code ?? code, env.grammar ?? grammar);
	Prism.hooks.run("after-tokenize", env);
	return env.tokens ?? code;
}

function convert(
	text: string,
	grammar: string,
	profile: LanguageProfile,
): Token[] {
	const opens = new Set(profile.colorizedBrackets.map(([open]) => open));
	const closes = new Set(profile.colorizedBrackets.map(([, close]) => close));
	const tokens: Token[] = [];
	let offset = 0,
		depth = 0;
	let fence: string | undefined;
	const visit = (
		stream: Prism.TokenStream,
		inherited = "",
		nesting = 0,
	): void => {
		if (nesting > 200)
			throw new Error("Syntax grammar nesting limit exceeded.");
		if (typeof stream === "string") {
			if (!inherited || inherited === "punctuation") {
				for (let i = 0; i < stream.length; i++) {
					const char = stream[i] ?? "";
					const open = opens.has(char),
						close = closes.has(char);
					if (close && !open) depth = Math.max(0, depth - 1);
					if ((open || close) && tokens.length < 150000)
						tokens.push({
							from: offset + i,
							to: offset + i + 1,
							kind: `bracket${depth % 3}`,
						});
					if (open && !close) depth++;
				}
			} else if (stream.length && tokens.length < 150000)
				tokens.push({
					from: offset,
					to: offset + stream.length,
					kind: inherited,
				});
			offset += stream.length;
		} else if (Array.isArray(stream)) {
			for (const item of stream) visit(item, inherited, nesting + 1);
		} else {
			const aliases =
				typeof stream.alias === "string"
					? [stream.alias]
					: (stream.alias ?? []);
			const kind =
				kinds[stream.type] ??
				aliases.map((alias) => kinds[alias]).find(Boolean) ??
				(stream.type === "punctuation" ? "punctuation" : inherited);
			if (stream.type === "code") fence = undefined;
			if (stream.type === "code-language")
				fence =
					typeof stream.content === "string"
						? fenceGrammar(stream.content)
						: undefined;
			if (
				stream.type === "code-block" &&
				fence &&
				typeof stream.content === "string"
			) {
				const language = fence;
				fence = undefined;
				visit(tokenize(stream.content, language), "", nesting + 1);
				return;
			}
			visit(stream.content, kind, nesting + 1);
		}
	};
	visit(tokenize(text, grammar));
	if (offset !== text.length)
		throw new Error("Syntax grammar changed source offsets.");
	return tokens;
}

export function syntaxTokens(document: LanguageDocument): Token[] {
	const { id, text, profile } = document;
	const grammar =
		profile.grammar && hasGrammar(profile.grammar)
			? profile.grammar
			: undefined;
	if (!grammar || text.length > 600000) {
		cache.delete(id);
		return tokenizeDocument(id, text, profile);
	}
	const key = `${embeddedVersion}:${JSON.stringify(profile)}`;
	const old = cache.get(id);
	if (old?.text === text && old.key === key) return [...old.tokens];
	disposeTokens(id);
	const tokens = convert(text, grammar, profile);
	cache.set(id, { text, key, tokens });
	return [...tokens];
}

export function disposeSyntaxTokens(id: string): void {
	cache.delete(id);
	disposeTokens(id);
}
