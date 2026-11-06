import { indentationWidth } from "../features/indentation-options";
import type { TextModel } from "../model/text-model";

export function activeIndentationGuide(
	model: TextModel,
	line: number,
	tabSize: number,
	visible: { first: number; last: number },
): { column: number; first: number; last: number } | undefined {
	if (line < visible.first || line > visible.last) return undefined;
	const width = (line: number) =>
		indentationWidth(
			model.getLineContent(line).match(/^[\t ]*/)?.[0] ?? "",
			tabSize,
		);
	const indent = width(line);
	if (!indent) return undefined;
	const column = Math.floor((indent - 1) / tabSize) * tabSize;
	const includes = (line: number) =>
		!model.getLineContent(line).trim() || width(line) > column;
	let first = line,
		last = line;
	while (first > visible.first && includes(first - 1)) first--;
	while (last < visible.last && includes(last + 1)) last++;
	return { column, first, last };
}
