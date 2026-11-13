import type { TextSelection } from "../api/types";
import type { EditingPlan } from "./editing-plan";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const maximumColumn = 10000;
export function columnBoundary(text: string, column: number, tabSize: number) {
	let cell = 0;
	for (const unit of segments.segment(text)) {
		const width = unit.segment === "\t" ? tabSize - (cell % tabSize) : 1;
		if (column < cell + width)
			return {
				offset: unit.index,
				inset: column - cell,
				width,
				tab: unit.segment === "\t",
				cell,
			};
		cell += width;
	}
	return {
		offset: text.length,
		inset: Math.max(0, column - cell),
		width: 0,
		tab: false,
		cell,
	};
}
export function displayColumn(text: string, tabSize: number): number {
	let cell = 0;
	for (const unit of segments.segment(text))
		cell += unit.segment === "\t" ? tabSize - (cell % tabSize) : 1;
	return cell;
}
export function columnRange(
	text: string,
	lineStart: number,
	from: number,
	to: number,
	tabSize: number,
): TextSelection {
	const start = Math.max(0, Math.min(maximumColumn, Math.min(from, to))),
		end = Math.max(start, Math.min(maximumColumn, Math.max(from, to)));
	const a = columnBoundary(text, start, tabSize),
		b = columnBoundary(text, end, tabSize);
	return {
		start: lineStart + a.offset,
		end: lineStart + b.offset + (start !== end && b.tab && b.inset ? 1 : 0),
		direction: to < from ? "backward" : to > from ? "forward" : "none",
		columns: { start, end },
	};
}
export function selectedColumns(
	source: string,
	selection: TextSelection,
	tabSize: number,
): string {
	if (!selection.columns) return source.slice(selection.start, selection.end);
	const lineStart =
		selection.start === 0
			? 0
			: source.lastIndexOf("\n", selection.start - 1) + 1;
	const end = source.indexOf("\n", lineStart),
		line = source.slice(lineStart, end < 0 ? source.length : end);
	let cell = 0,
		result = "";
	for (const unit of segments.segment(line)) {
		const width = unit.segment === "\t" ? tabSize - (cell % tabSize) : 1;
		const overlap = Math.max(
			0,
			Math.min(cell + width, selection.columns.end) -
				Math.max(cell, selection.columns.start),
		);
		if (overlap)
			result +=
				unit.segment === "\t" ? " ".repeat(overlap) : unit.segment;
		cell += width;
		if (cell >= selection.columns.end) break;
	}
	return (
		result +
		" ".repeat(
			Math.max(
				0,
				selection.columns.end - Math.max(cell, selection.columns.start),
			),
		)
	);
}
export function replaceColumns(
	source: string,
	selection: TextSelection,
	text: string,
	tabSize: number,
): EditingPlan {
	if (!selection.columns)
		return {
			edits: [{ from: selection.start, to: selection.end, text }],
			selection: {
				start: selection.start + text.length,
				end: selection.start + text.length,
				direction: "none",
			},
		};
	const lineStart =
		selection.start === 0
			? 0
			: source.lastIndexOf("\n", selection.start - 1) + 1;
	const lineEnd = source.indexOf("\n", lineStart),
		line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
	const a = columnBoundary(line, selection.columns.start, tabSize),
		b = columnBoundary(line, selection.columns.end, tabSize);
	if (!text && a.offset === line.length)
		return {
			edits: [],
			selection: {
				...selection,
				end: selection.start,
				direction: "none",
				columns: {
					start: selection.columns.start,
					end: selection.columns.start,
				},
			},
		};
	const left = " ".repeat(a.inset),
		right = b.tab && b.inset ? " ".repeat(b.width - b.inset) : "";
	const at = lineStart + a.offset + left.length + text.length;
	return {
		edits: [
			{
				from: lineStart + a.offset,
				to: lineStart + b.offset + (b.tab && b.inset ? 1 : 0),
				text: left + text + right,
			},
		],
		selection: { start: at, end: at, direction: "none" },
	};
}
