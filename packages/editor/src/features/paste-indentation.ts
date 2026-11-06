import type { TextSelection } from "../api/types";
import {
	type IndentationOptions,
	indentationText,
	indentationWidth,
} from "./indentation-options";

export function indentPastedText(
	document: string,
	selection: TextSelection,
	value: string,
	options: IndentationOptions,
): string {
	if (!value.includes("\n")) return value;
	const start =
		selection.start === 0
			? 0
			: document.lastIndexOf("\n", selection.start - 1) + 1;
	const prefix = document.slice(start, selection.start);
	if (!/^[\t ]*$/.test(prefix)) return value;
	const lines = value.split("\n");
	const nonblank = lines.filter((line) => line.trim());
	if (!nonblank.length) return value;
	const leading = (line: string) => line.match(/^[\t ]*/)?.[0] ?? "";
	let margin = Infinity;
	for (const line of nonblank)
		margin = Math.min(
			margin,
			indentationWidth(leading(line), options.tabSize),
		);
	const target = indentationWidth(prefix, options.tabSize);
	return lines
		.map((line, index) => {
			if (!line.trim()) return "";
			const indent = leading(line);
			return (
				indentationText(
					(index ? target : 0) +
						Math.max(
							0,
							indentationWidth(indent, options.tabSize) - margin,
						),
					options,
				) + line.slice(indent.length)
			);
		})
		.join("\n");
}
