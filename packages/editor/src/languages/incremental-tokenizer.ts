import type { Token } from "../api/languages";

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
const keywords = new Set(
	"const let var function return if else for while class interface type import export from new async await true false null undefined throw try catch switch case break extends implements public private readonly number string boolean void def elif None True False fn pub use impl struct enum match mut self mod crate async await select where yield in of do finally static constructor get set this super package protected abstract override as is keyof typeof instanceof delete void".split(
		" ",
	),
);
const identifier = /[\p{ID_Start}_$][\p{ID_Continue}$]*/uy,
	number = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?/y;
function lineTokens(
	text: string,
	state: State,
	language: string,
): { tokens: Token[]; outgoing: State } {
	const tokens: Token[] = [];
	let mode = state.mode,
		depth = state.depth,
		index = 0;
	const add = (from: number, to: number, kind: string) => {
		if (to > from) tokens.push({ from, to, kind });
	};
	while (index < text.length) {
		const from = index;
		if (mode) {
			const close =
				mode === "block" ? "*/" : mode === "html" ? "-->" : mode;
			let end = text.indexOf(close, index);
			if (close === "`" || close === '"' || close === "'") {
				while (end >= 0) {
					let escapes = 0;
					for (let at = end - 1; at >= 0 && text[at] === "\\"; at--)
						escapes++;
					if (escapes % 2 === 0) break;
					end = text.indexOf(close, end + 1);
				}
			}
			if (end < 0) {
				add(
					index,
					text.length,
					mode === "block" || mode === "html" ? "comment" : "string",
				);
				break;
			}
			index = end + close.length;
			add(
				from,
				index,
				mode === "block" || mode === "html" ? "comment" : "string",
			);
			mode = "";
			continue;
		}
		if (/\s/u.test(text[index] ?? "")) {
			index++;
			continue;
		}
		if (
			(text.startsWith("//", index) &&
				!["html", "markdown", "python", "shell"].includes(language)) ||
			(text[index] === "#" && ["python", "shell"].includes(language))
		) {
			add(index, text.length, "comment");
			break;
		}
		if (
			text.startsWith("/*", index) &&
			!["python", "shell", "markdown"].includes(language)
		) {
			mode = "block";
			index += 2;
			const end = text.indexOf("*/", index);
			if (end < 0) {
				add(from, text.length, "comment");
				break;
			}
			index = end + 2;
			add(from, index, "comment");
			mode = "";
			continue;
		}
		if (language === "html" && text.startsWith("<!--", index)) {
			mode = "html";
			index += 4;
			const end = text.indexOf("-->", index);
			if (end < 0) {
				add(from, text.length, "comment");
				break;
			}
			index = end + 3;
			add(from, index, "comment");
			mode = "";
			continue;
		}
		if (language === "markdown" && text.startsWith("```", index)) {
			mode = "```";
			add(index, text.length, "string");
			break;
		}
		const quote = text[index];
		if (quote === '"' || quote === "'" || quote === "`") {
			const triple =
					language === "python" &&
					text.startsWith(quote.repeat(3), index),
				closing = triple ? quote.repeat(3) : quote;
			index += closing.length;
			let end = index;
			for (; end < text.length; end++) {
				if (text[end] === "\\") {
					end++;
					continue;
				}
				if (text.startsWith(closing, end)) break;
			}
			if (end >= text.length) {
				mode = quote === "`" || triple ? closing : "";
				add(from, text.length, "string");
				break;
			}
			index = end + closing.length;
			add(
				from,
				index,
				(language === "json" || language === "jsonc") &&
					/^\s*:/.test(text.slice(index))
					? "type"
					: "string",
			);
			continue;
		}
		if (language === "markdown" && quote === "#") {
			add(index, text.length, "keyword");
			break;
		}
		if (language === "html" && quote === "<") {
			const tag = text.slice(index).match(/^<\/?[\w:-]+/);
			if (tag) {
				index += tag[0].length;
				add(from, index, "keyword");
				continue;
			}
		}
		identifier.lastIndex = index;
		const word = identifier.exec(text);
		if (word) {
			index = identifier.lastIndex;
			const kind = keywords.has(word[0])
				? "keyword"
				: /^[A-Z]/.test(word[0])
					? "type"
					: language === "html" && /^\s*=/.test(text.slice(index))
						? "type"
						: "";
			if (kind) add(from, index, kind);
			continue;
		}
		number.lastIndex = index;
		const numeric = number.exec(text);
		if (numeric) {
			index = number.lastIndex;
			add(from, index, "number");
			continue;
		}
		if (/[()[\]{}]/.test(quote ?? "")) {
			if (/[)\]}]/.test(quote ?? "")) depth = Math.max(0, depth - 1);
			add(index, index + 1, `bracket${depth % 3}`);
			if (/[([{]/.test(quote ?? "")) depth++;
		}
		index++;
	}
	return { tokens, outgoing: { mode, depth } };
}
export class IncrementalTokenizer {
	private entries: LineTokens[] = [];
	private language = "";
	reused = 0;
	update(text: string, language: string): Token[] {
		if (language === "plaintext") {
			this.entries = [];
			return [];
		}
		const lines = text.split("\n"),
			next: LineTokens[] = [],
			tokens: Token[] = [];
		let state: State = { mode: "", depth: 0 },
			offset = 0;
		this.reused = 0;
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index] ?? "",
				key = `${state.mode}:${state.depth}`,
				old = this.entries[index];
			let entry: LineTokens;
			if (
				language === this.language &&
				old?.text === line &&
				old.incoming === key
			) {
				entry = old;
				this.reused++;
			} else {
				const result = lineTokens(line, state, language);
				entry = {
					text: line,
					incoming: key,
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
		this.language = language;
		return tokens;
	}
}
const instances = new Map<string, IncrementalTokenizer>();
export function tokenizeDocument(
	id: string,
	text: string,
	language: string,
): Token[] {
	let instance = instances.get(id);
	if (!instance) {
		instance = new IncrementalTokenizer();
		instances.set(id, instance);
	}
	return instance.update(text, language);
}
export function disposeTokens(id: string): void {
	instances.delete(id);
}
