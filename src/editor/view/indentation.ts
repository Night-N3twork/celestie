import type { EditorSettings } from "../../settings/editorSettings";

export function indentSelection(
	text: string,
	start: number,
	end: number,
	settings: EditorSettings,
	outdent: boolean,
) {
	const indent = settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t";
	const first = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
	if (!outdent && !text.slice(start, end).includes("\n")) {
		let column = 0;
		for (const character of text.slice(first, start))
			column +=
				character === "\t"
					? settings.tabSize - (column % settings.tabSize)
					: 1;
		const spaces = settings.insertSpaces
			? " ".repeat(settings.tabSize - (column % settings.tabSize))
			: indent;
		return {
			text: text.slice(0, start) + spaces + text.slice(end),
			start: start + spaces.length,
			end: start + spaces.length,
		};
	}
	const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
	const changes: { offset: number; removed: number; added: string }[] = [];
	for (let offset = first; offset <= last; ) {
		let removed = 0;
		if (outdent) {
			if (text[offset] === "\t") removed = 1;
			else
				while (
					removed < settings.tabSize &&
					text[offset + removed] === " "
				)
					removed++;
		}
		changes.push({ offset, removed, added: outdent ? "" : indent });
		const next = text.indexOf("\n", offset);
		if (next < 0) break;
		offset = next + 1;
	}
	const map = (position: number) => {
		let delta = 0;
		for (const change of changes) {
			if (position < change.offset) break;
			if (position < change.offset + change.removed)
				return change.offset + delta;
			delta += change.added.length - change.removed;
		}
		return position + delta;
	};
	const pieces: string[] = [];
	let cursor = 0;
	for (const change of changes) {
		pieces.push(text.slice(cursor, change.offset), change.added);
		cursor = change.offset + change.removed;
	}
	pieces.push(text.slice(cursor));
	return { text: pieces.join(""), start: map(start), end: map(end) };
}
