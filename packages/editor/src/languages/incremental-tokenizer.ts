import type { Token } from "../api/languages";
import type { LanguageProfile } from "../workers/language-protocol";

interface State {
	mode: string;
	depth: number;
}
interface LineTokens {
	text: string;
	incoming: string;
	outgoing: State;
	tokens: Token[];
}

class Lexer {
	readonly key: string;
	private readonly word: RegExp;
	private readonly keywords: ReadonlySet<string>;
	private readonly opens: ReadonlySet<string>;
	private readonly closes: ReadonlySet<string>;
	private readonly number = /[-+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?/y;
	constructor(readonly profile: LanguageProfile) {
		this.key = JSON.stringify(profile);
		this.word = new RegExp(
			profile.word.source,
			`${profile.word.flags.replace(/[gy]/g, "")}y`,
		);
		this.keywords = new Set(profile.keywords);
		this.opens = new Set(profile.colorizedBrackets.map(([open]) => open));
		this.closes = new Set(
			profile.colorizedBrackets.map(([, close]) => close),
		);
	}
	line(text: string, state: State): { tokens: Token[]; outgoing: State } {
		const { lineComment, blockComment, quotes, templateQuote } =
			this.profile;
		const tokens: Token[] = [];
		let mode = state.mode,
			depth = state.depth,
			index = 0;
		const add = (from: number, to: number, kind: string) => {
			if (to > from) tokens.push({ from, to, kind });
		};
		const closeQuote = (quote: string, from: number): number => {
			for (let at = from; at < text.length; at++) {
				if (text[at] === "\\") at++;
				else if (text.startsWith(quote, at)) return at + quote.length;
			}
			return -1;
		};
		while (index < text.length) {
			const from = index;
			if (mode === "block" && blockComment) {
				const end = text.indexOf(blockComment[1], index);
				if (end < 0) {
					add(index, text.length, "comment");
					break;
				}
				index = end + blockComment[1].length;
				add(from, index, "comment");
				mode = "";
				continue;
			}
			if (mode) {
				const end = closeQuote(mode, index);
				if (end < 0) {
					add(index, text.length, "string");
					break;
				}
				index = end;
				add(from, index, "string");
				mode = "";
				continue;
			}
			const char = text[index] ?? "";
			if (/\s/u.test(char)) {
				index++;
				continue;
			}
			if (lineComment && text.startsWith(lineComment, index)) {
				add(index, text.length, "comment");
				break;
			}
			if (blockComment && text.startsWith(blockComment[0], index)) {
				const end = text.indexOf(
					blockComment[1],
					index + blockComment[0].length,
				);
				if (end < 0) {
					mode = "block";
					add(from, text.length, "comment");
					break;
				}
				index = end + blockComment[1].length;
				add(from, index, "comment");
				continue;
			}
			if (quotes.includes(char)) {
				const end = closeQuote(char, index + 1);
				if (end < 0) {
					if (char === templateQuote) mode = char;
					add(from, text.length, "string");
					break;
				}
				index = end;
				add(from, index, "string");
				continue;
			}
			if (this.opens.has(char) || this.closes.has(char)) {
				if (!this.opens.has(char)) depth = Math.max(0, depth - 1);
				add(index, index + 1, `bracket${depth % 3}`);
				if (!this.closes.has(char)) depth++;
				index++;
				continue;
			}
			this.number.lastIndex = index;
			const numeric = this.number.exec(text);
			if (numeric && !/[\p{L}_$]/u.test(text[index - 1] ?? "")) {
				index = this.number.lastIndex;
				add(from, index, "number");
				continue;
			}
			this.word.lastIndex = index;
			const word = this.word.exec(text);
			if (word?.[0]) {
				index = this.word.lastIndex;
				const kind = this.keywords.has(word[0])
					? "keyword"
					: /^\p{Lu}/u.test(word[0])
						? "type"
						: "";
				if (kind) add(from, index, kind);
				continue;
			}
			index++;
		}
		return { tokens, outgoing: { mode, depth } };
	}
}

export class IncrementalTokenizer {
	private entries: LineTokens[] = [];
	private lexer: Lexer | undefined;
	reused = 0;
	update(text: string, profile: LanguageProfile): Token[] {
		const key = JSON.stringify(profile);
		if (this.lexer?.key !== key) {
			this.lexer = new Lexer(profile);
			this.entries = [];
		}
		const lexer = this.lexer;
		const lines = text.split("\n"),
			next: LineTokens[] = [],
			tokens: Token[] = [];
		let state: State = { mode: "", depth: 0 },
			offset = 0;
		this.reused = 0;
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index] ?? "",
				incoming = `${state.mode}:${state.depth}`,
				old = this.entries[index];
			let entry: LineTokens;
			if (old?.text === line && old.incoming === incoming) {
				entry = old;
				this.reused++;
			} else {
				const result = lexer.line(line, state);
				entry = {
					text: line,
					incoming,
					outgoing: result.outgoing,
					tokens: result.tokens,
				};
			}
			next.push(entry);
			state = entry.outgoing;
			for (const token of entry.tokens)
				if (tokens.length < 150000)
					tokens.push({
						from: offset + token.from,
						to: offset + token.to,
						kind: token.kind,
					});
			offset += line.length + 1;
		}
		this.entries = next;
		return tokens;
	}
}
const instances = new Map<string, IncrementalTokenizer>();
export function tokenizeDocument(
	id: string,
	text: string,
	profile: LanguageProfile,
): Token[] {
	let instance = instances.get(id);
	if (!instance) {
		instance = new IncrementalTokenizer();
		instances.set(id, instance);
	}
	return instance.update(text, profile);
}
export function disposeTokens(id: string): void {
	instances.delete(id);
}
