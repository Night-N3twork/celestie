import type { Position } from "../api/types";

export function normalizeInputText(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

export function getLineIndent(text: string, offset: number): string {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	return text.slice(lineStart, offset).match(/^[\t ]*/)?.[0] ?? "";
}

export function getInputLineRange(
	text: string,
	line: number,
): { from: number; to: number } {
	let from = 0;
	for (let current = 1; current < line; current++) {
		const newline = text.indexOf("\n", from);
		if (newline === -1) return { from: text.length, to: text.length };
		from = newline + 1;
	}
	const newline = text.indexOf("\n", from);
	return { from, to: newline === -1 ? text.length : newline + 1 };
}

export function getInputPosition(text: string, offset: number): Position {
	let line = 1;
	let lineStart = 0;
	let next = text.indexOf("\n");
	while (next !== -1 && next < offset) {
		line++;
		lineStart = next + 1;
		next = text.indexOf("\n", lineStart);
	}
	return { line, column: offset - lineStart + 1 };
}

export function findTextChange(before: string, after: string) {
	if (before === after) return null;

	let start = 0;

	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	) {
		start++;
	}

	if (before[start - 1] === "\r" && before[start] === "\n") {
		start--;
	}

	let oldEnd = before.length;
	let newEnd = after.length;

	while (
		oldEnd > start &&
		newEnd > start &&
		before[oldEnd - 1] === after[newEnd - 1]
	) {
		oldEnd--;
		newEnd--;
	}

	if (before[oldEnd - 1] === "\r" && before[oldEnd] === "\n") {
		oldEnd++;
		newEnd++;
	}

	return {
		from: start,
		to: oldEnd,
		text: after.slice(start, newEnd),
	};
}
