import type { TextEdit } from "../core/document";

export function displayText(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

export function documentOffset(text: string, offset: number): number {
	let source = 0;
	let visible = 0;
	while (source < text.length && visible < offset) {
		if (text[source] === "\r" && text[source + 1] === "\n") source++;
		source++;
		visible++;
	}
	return source;
}

export function displayOffset(text: string, offset: number): number {
	return displayText(text.slice(0, offset)).length;
}

export function inputEdit(text: string, after: string): TextEdit | undefined {
	const before = displayText(text);
	if (before === after) return;
	let from = 0;
	while (
		from < before.length &&
		from < after.length &&
		before[from] === after[from]
	)
		from++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (
		endBefore > from &&
		endAfter > from &&
		before[endBefore - 1] === after[endAfter - 1]
	) {
		endBefore--;
		endAfter--;
	}
	const ending = text.includes("\r\n")
		? "\r\n"
		: text.includes("\r")
			? "\r"
			: "\n";
	return {
		from: documentOffset(text, from),
		to: documentOffset(text, endBefore),
		text: after.slice(from, endAfter).replace(/\n/g, ending),
	};
}
