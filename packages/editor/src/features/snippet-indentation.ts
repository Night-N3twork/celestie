import {
	type IndentationOptions,
	indentationUnit,
} from "./indentation-options";
import type { ParsedSnippet } from "./snippets";

export function indentSnippet(
	parsed: ParsedSnippet,
	indent: string,
	options: IndentationOptions,
): ParsedSnippet {
	const offsets = [0];
	let text = "";
	for (const char of parsed.text.split("")) {
		text +=
			char === "\t"
				? indentationUnit(options)
				: char === "\n"
					? `\n${indent}`
					: char;
		offsets.push(text.length);
	}
	const map = <T extends { from: number; to: number }>(stop: T): T => ({
		...stop,
		from: offsets[stop.from] ?? text.length,
		to: offsets[stop.to] ?? text.length,
	});
	return {
		text,
		stops: parsed.stops.map(map),
		transforms: parsed.transforms.map((stop) => ({
			...map(stop),
			formatIndent: { newline: indent, tab: indentationUnit(options) },
		})),
	};
}
