import type { TextSelection } from "../api/types";
import {
	defaultIndentation,
	type IndentationOptions,
	indentationUnit,
	indentationWidth,
} from "./indentation-options";

export type { TextSelection } from "../api/types";

interface IndentationEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

export interface IndentationPlan {
	readonly edits: readonly IndentationEdit[];
	readonly selection: TextSelection;
}

export function planIndentation(
	text: string,
	selection: TextSelection,
	direction: "indent" | "outdent",
	options: IndentationOptions = defaultIndentation,
): IndentationPlan {
	const collapsed = selection.start === selection.end;
	const edits: IndentationEdit[] = [];
	if (collapsed && direction === "indent") {
		const from =
			selection.start === 0
				? 0
				: text.lastIndexOf("\n", selection.start - 1) + 1;
		const column = indentationWidth(
			text.slice(from, selection.start),
			options.tabSize,
		);
		edits.push({
			from: selection.start,
			to: selection.end,
			text: options.insertSpaces
				? " ".repeat(options.tabSize - (column % options.tabSize))
				: "\t",
		});
	} else {
		let lineStart =
			selection.start === 0
				? 0
				: text.lastIndexOf("\n", selection.start - 1) + 1;
		const lastOffset =
			!collapsed && text[selection.end - 1] === "\n"
				? selection.end - 1
				: selection.end;
		while (lineStart <= lastOffset) {
			if (direction === "indent") {
				edits.push({
					from: lineStart,
					to: lineStart,
					text: indentationUnit(options),
				});
			} else {
				let end = lineStart;
				let columns = 0;
				while (
					columns < options.tabSize &&
					(text[end] === " " || text[end] === "\t")
				) {
					columns +=
						text[end] === "\t"
							? options.tabSize - (columns % options.tabSize)
							: 1;
					end++;
				}
				if (end > lineStart)
					edits.push({ from: lineStart, to: end, text: "" });
			}
			const newline = text.indexOf("\n", lineStart);
			if (newline === -1) break;
			lineStart = newline + 1;
		}
	}

	const mapOffset = (
		offset: number,
		affinity: "before" | "after",
	): number => {
		let delta = 0;
		for (const edit of edits) {
			if (offset < edit.from) break;
			if (offset <= edit.to) {
				return (
					edit.from +
					delta +
					(affinity === "after" ? edit.text.length : 0)
				);
			}
			delta += edit.text.length - (edit.to - edit.from);
		}
		return offset + delta;
	};
	return {
		edits,
		selection: {
			start: mapOffset(selection.start, collapsed ? "after" : "before"),
			end: mapOffset(selection.end, "after"),
			direction: selection.direction,
		},
	};
}
