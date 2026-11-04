import type { Token } from "../api/languages";

const keywords = new Set(
	"const let var function return if else for while class interface type import export from new async await true false null undefined throw try catch switch case break extends implements public private readonly number string boolean void def elif None True False fn pub use impl struct enum match mut self mod crate async await select where yield in of do finally static constructor get set this super".split(
		" ",
	),
);
export function tokenize(text: string, language: string): Token[] {
	if (language === "plaintext") return [];
	const pattern =
		language === "html"
			? /<!--[\s\S]*?-->|<\/?[\w:-]+|\b[\w:-]+(?==)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
			: language === "markdown"
				? /^#{1,6}[^\n]*|```[\s\S]*?```|`[^`\n]*`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]*\)/gm
				: /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?(?:n)?\b|[\p{ID_Start}_$][\p{ID_Continue}$]*/gu;
	const result: Token[] = [];
	for (const match of text.matchAll(pattern)) {
		const word = match[0];
		let kind =
			word.startsWith("//") ||
			word.startsWith("/*") ||
			word.startsWith("<!--") ||
			((language === "python" || language === "shell") &&
				word.startsWith("#"))
				? "comment"
				: /^["'`]/.test(word)
					? "string"
					: /^\d/.test(word)
						? "number"
						: keywords.has(word)
							? "keyword"
							: language === "html"
								? word.startsWith("<")
									? "keyword"
									: "type"
								: /^[A-Z]/.test(word)
									? "type"
									: "identifier";
		if (language === "markdown")
			kind = word.startsWith("#") ? "keyword" : "string";
		if (kind !== "identifier")
			result.push({
				from: match.index,
				to: match.index + word.length,
				kind,
			});
		if (result.length >= 150000) break;
	}
	return result;
}
export function indentationFolds(
	text: string,
): { start: number; end: number }[] {
	const lines = text.split("\n"),
		stack: { line: number; indent: number }[] = [],
		result: { start: number; end: number }[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (!line.trim()) continue;
		const indent = (line.match(/^[\t ]*/)?.[0] ?? "").replace(
			/\t/g,
			"    ",
		).length;
		while (stack.length && indent <= (stack.at(-1)?.indent ?? 0)) {
			const old = stack.pop();
			if (old && index - old.line > 1)
				result.push({ start: old.line + 1, end: index });
		}
		const previous = lines[index - 1];
		if (index && previous?.trim()) {
			const before = (previous.match(/^[\t ]*/)?.[0] ?? "").replace(
				/\t/g,
				"    ",
			).length;
			if (indent > before)
				stack.push({ line: index - 1, indent: before });
		}
	}
	for (const entry of stack)
		if (lines.length - entry.line > 1)
			result.push({ start: entry.line + 1, end: lines.length });
	return result;
}
