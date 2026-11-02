import type { TextSelection } from "../api/types";
import { TextBuffer } from "../model/text-buffer";
import type { EditingPlan } from "./editing-plan";

export type LineCommand =
	| "moveUp"
	| "moveDown"
	| "duplicateUp"
	| "duplicateDown"
	| "delete"
	| "insertAbove"
	| "insertBelow";

export function planLineCommand(
	text: string,
	selection: TextSelection,
	command: LineCommand,
): EditingPlan | undefined {
	const buffer = new TextBuffer(text);
	const start = buffer.getPositionAt(selection.start);
	const end = buffer.getPositionAt(selection.end);
	const first = start.line;
	const last =
		end.line -
		(selection.end > selection.start && end.column === 1 ? 1 : 0);
	const lineStart = (line: number): number =>
		buffer.getOffsetAt({ line, column: 1 });
	const lineEnd = (line: number): number =>
		buffer.getOffsetAt({ line, column: buffer.getLineMaxColumn(line) });
	const from = lineStart(first);
	const to = lineEnd(last);
	const block = text.slice(from, to);
	const collapsed = (offset: number): TextSelection => ({
		start: offset,
		end: offset,
		direction: "none",
	});
	const shift = (delta: number): TextSelection => ({
		...selection,
		start: Math.max(0, Math.min(text.length, selection.start + delta)),
		end: Math.max(0, Math.min(text.length, selection.end + delta)),
	});

	if (command === "moveUp") {
		if (first === 1) return undefined;
		const previous = lineStart(first - 1);
		return {
			edits: [
				{
					from: previous,
					to,
					text: `${block}\n${text.slice(previous, from - 1)}`,
				},
			],
			selection: shift(previous - from),
		};
	}
	if (command === "moveDown") {
		if (last === buffer.getLineCount()) return undefined;
		const following = lineEnd(last + 1);
		const next = text.slice(to + 1, following);
		return {
			edits: [{ from, to: following, text: `${next}\n${block}` }],
			selection: shift(next.length + 1),
		};
	}
	if (command === "duplicateUp" || command === "duplicateDown") {
		const up = command === "duplicateUp";
		const offset = up ? from : to;
		const delta = up ? 0 : block.length + 1;
		return {
			edits: [
				{
					from: offset,
					to: offset,
					text: up ? `${block}\n` : `\n${block}`,
				},
			],
			selection: {
				...selection,
				start: selection.start + delta,
				end: selection.end + delta,
			},
		};
	}
	if (command === "delete") {
		if (!text) return undefined;
		if (last < buffer.getLineCount()) {
			const caret =
				from +
				Math.min(
					start.column - 1,
					buffer.getLineContent(last + 1).length,
				);
			return {
				edits: [{ from, to: to + 1, text: "" }],
				selection: collapsed(caret),
			};
		}
		const previous = first > 1 ? first - 1 : 1;
		const caret =
			first > 1
				? lineStart(previous) +
					Math.min(
						start.column - 1,
						buffer.getLineContent(previous).length,
					)
				: 0;
		return {
			edits: [
				{ from: first > 1 ? from - 1 : 0, to: text.length, text: "" },
			],
			selection: collapsed(caret),
		};
	}
	const above = command === "insertAbove";
	const indent =
		buffer.getLineContent(above ? first : last).match(/^[\t ]*/)?.[0] ?? "";
	const offset = above ? from : to;
	return {
		edits: [
			{
				from: offset,
				to: offset,
				text: above ? `${indent}\n` : `\n${indent}`,
			},
		],
		selection: collapsed(offset + indent.length + (above ? 0 : 1)),
	};
}
