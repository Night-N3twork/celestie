import type { TextEdit } from "./document";
import { type Selection, selectionRange } from "./selection";

function adjacent(
	text: string,
	offset: number,
	backwards: boolean,
	word = false,
): number {
	if (backwards && offset === 0) return 0;
	if (!backwards && offset === text.length) return offset;
	const segmenter = new Intl.Segmenter(undefined, {
		granularity: word ? "word" : "grapheme",
	});
	const segments = segmenter.segment(text);
	let segment = segments.containing(backwards ? offset - 1 : offset);
	if (word)
		while (segment && !segment.isWordLike) {
			const next = backwards
				? segment.index - 1
				: segment.index + segment.segment.length;
			if (next < 0 || next >= text.length) break;
			segment = segments.containing(next);
		}
	return segment
		? backwards
			? segment.index
			: segment.index + segment.segment.length
		: offset;
}

export function multiEdit(
	text: string,
	primary: Selection,
	secondary: readonly Selection[],
	edit: TextEdit,
	distributePaste = false,
): { edit: TextEdit; primary: Selection; secondary: Selection[] } {
	const primaryRange = selectionRange(primary);
	const entries = [
		{ ...edit, primary: true },
		...secondary.map((selection) => {
			let range = selectionRange(selection);
			if (
				range.from === range.to &&
				primaryRange.from === primaryRange.to &&
				edit.from < primary.head &&
				edit.to === primary.head
			)
				range = {
					from: adjacent(
						text,
						range.from,
						true,
						primary.head - edit.from >
							primary.head - adjacent(text, primary.head, true),
					),
					to: range.to,
				};
			else if (
				range.from === range.to &&
				primaryRange.from === primaryRange.to &&
				edit.from === primary.head &&
				edit.to > primary.head
			)
				range = {
					from: range.from,
					to: adjacent(
						text,
						range.to,
						false,
						edit.to - primary.head >
							adjacent(text, primary.head, false) - primary.head,
					),
				};
			return { ...range, text: edit.text, primary: false };
		}),
	].sort((a, b) => a.from - b.from || a.to - b.to);
	const unique: typeof entries = [];
	for (const entry of entries) {
		const previous = unique.at(-1);
		if (
			previous &&
			entry.from === previous.from &&
			entry.to === previous.to
		) {
			previous.primary ||= entry.primary;
			continue;
		}
		if (
			previous &&
			(entry.from < previous.to ||
				(entry.from === previous.to &&
					(entry.from === entry.to || previous.from === previous.to)))
		) {
			previous.to = Math.max(previous.to, entry.to);
			previous.primary ||= entry.primary;
			continue;
		}
		unique.push(entry);
	}
	const from = unique[0].from;
	const pasted = edit.text.split(/\r\n|\r|\n/);
	if (distributePaste && pasted.length === unique.length)
		for (let index = 0; index < unique.length; index++)
			unique[index].text = pasted[index];
	const to = unique[unique.length - 1].to;
	const pieces: string[] = [];
	let cursor = from;
	let length = from;
	let selected: Selection = { anchor: 0, head: 0 };
	const others: Selection[] = [];
	for (const entry of unique) {
		const unchanged = text.slice(cursor, entry.from);
		pieces.push(unchanged, entry.text);
		length += unchanged.length + entry.text.length;
		const selection = { anchor: length, head: length };
		if (entry.primary) selected = selection;
		else others.push(selection);
		cursor = entry.to;
	}
	return {
		edit: { from, to, text: pieces.join("") },
		primary: selected,
		secondary: others,
	};
}
