import type { TextSelection } from "../api/types";
import { TextBuffer } from "../model/text-buffer";
import type { BracketAnalysis } from "./bracket-analysis";
import { type EditingPlan, type InputEdit, mapSelection } from "./editing-plan";

export type TextCommand =
	| "joinLines"
	| "sortAscending"
	| "sortDescending"
	| "uniqueLines"
	| "reverseLines"
	| "upperCase"
	| "lowerCase"
	| "titleCase"
	| "camelCase"
	| "pascalCase"
	| "snakeCase"
	| "kebabCase"
	| "transpose"
	| "trimTrailingWhitespace"
	| "insertFinalNewline"
	| "trimFinalNewlines"
	| "deleteAllLeft"
	| "deleteAllRight";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const word = /[\p{ID_Continue}$]+/gu;

export function wordRange(
	text: string,
	offset: number,
): { from: number; to: number } {
	for (const match of text.matchAll(word))
		if (match.index <= offset && offset <= match.index + match[0].length)
			return { from: match.index, to: match.index + match[0].length };
	return { from: offset, to: offset };
}

export function wordBoundary(
	text: string,
	offset: number,
	direction: -1 | 1,
	subword = false,
): number {
	const tokens = [
		...text.matchAll(/[\p{ID_Continue}$]+|\s+|[^\p{ID_Continue}$\s]+/gu),
	];
	const ordered = direction < 0 ? tokens.reverse() : tokens;
	for (const token of ordered) {
		const from = token.index;
		const to = from + token[0].length;
		if (direction < 0 ? from >= offset : to <= offset) continue;
		if (/^\s+$/u.test(token[0])) continue;
		if (!subword) return direction < 0 ? from : to;
		const units = [...token[0]];
		const boundaries = [from];
		let position = from;
		for (let index = 0; index < units.length; index++) {
			const previous = units[index - 1] ?? "";
			const current = units[index] ?? "";
			const next = units[index + 1] ?? "";
			if (
				index &&
				!/\p{M}/u.test(current) &&
				((previous === "_") !== (current === "_") ||
					(/\p{Ll}/u.test(previous) && /\p{Lu}/u.test(current)) ||
					(/\p{Lu}/u.test(previous) &&
						/\p{Lu}/u.test(current) &&
						/\p{Ll}/u.test(next)) ||
					/\p{N}/u.test(previous) !== /\p{N}/u.test(current))
			)
				boundaries.push(position);
			position += current.length;
		}
		boundaries.push(to);
		return direction < 0
			? (boundaries.filter((value) => value < offset).at(-1) ?? from)
			: (boundaries.find((value) => value > offset) ?? to);
	}
	return direction < 0 ? 0 : text.length;
}

export function planWordCommand(
	text: string,
	selection: TextSelection,
	direction: -1 | 1,
	action: "move" | "select" | "delete",
	subword = false,
): EditingPlan {
	const active =
		selection.direction === "backward" ? selection.start : selection.end;
	const target =
		action === "move" && selection.start !== selection.end
			? direction < 0
				? selection.start
				: selection.end
			: wordBoundary(text, active, direction, subword);
	if (action === "delete") {
		const from =
			selection.start !== selection.end
				? selection.start
				: Math.min(active, target);
		const to =
			selection.start !== selection.end
				? selection.end
				: Math.max(active, target);
		return {
			edits: [{ from, to, text: "" }],
			selection: { start: from, end: from, direction: "none" },
		};
	}
	const anchor =
		action === "select"
			? selection.direction === "backward"
				? selection.end
				: selection.start
			: target;
	return {
		edits: [],
		selection: {
			start: Math.min(anchor, target),
			end: Math.max(anchor, target),
			direction: target < anchor ? "backward" : "forward",
		},
	};
}

export function expansionRanges(
	text: string,
	selection: TextSelection,
	analysis: BracketAnalysis,
): readonly TextSelection[] {
	const buffer = new TextBuffer(text);
	const first = buffer.getPositionAt(selection.start).line;
	const last = buffer.getPositionAt(selection.end).line;
	const range = wordRange(text, selection.start);
	const ranges = [
		{ start: range.from, end: range.to },
		...analysis.enclosingRanges(selection.start, selection.end),
		{
			start: buffer.getOffsetAt({ line: first, column: 1 }),
			end: buffer.getOffsetAt({
				line: last,
				column: buffer.getLineMaxColumn(last),
			}),
		},
		{ start: 0, end: text.length },
	];
	return ranges
		.filter(
			(range) =>
				range.start <= selection.start &&
				range.end >= selection.end &&
				(range.start < selection.start || range.end > selection.end),
		)
		.sort((a, b) => a.end - a.start - (b.end - b.start))
		.map((range) => ({ ...range, direction: selection.direction }));
}

export function planTextCommand(
	text: string,
	selection: TextSelection,
	command: TextCommand,
): EditingPlan | undefined {
	const replace = (
		from: number,
		to: number,
		value: string,
		select = false,
	): EditingPlan => ({
		edits: [{ from, to, text: value }],
		selection: select
			? {
					start: from,
					end: from + value.length,
					direction: selection.direction,
				}
			: {
					start: from + value.length,
					end: from + value.length,
					direction: "none",
				},
	});
	if (command === "trimTrailingWhitespace") {
		const edits: InputEdit[] = [...text.matchAll(/[\t ]+(?=\n|$)/g)].map(
			(match) => ({
				from: match.index,
				to: match.index + match[0].length,
				text: "",
			}),
		);
		return { edits, selection: mapSelection(selection, edits) };
	}
	if (command === "insertFinalNewline" || command === "trimFinalNewlines") {
		const from =
			command === "insertFinalNewline"
				? text.length
				: text.search(/\n+$/);
		if (
			(command === "insertFinalNewline" && text.endsWith("\n")) ||
			from < 0
		)
			return undefined;
		const edits = [{ from, to: text.length, text: "\n" }];
		return { edits, selection: mapSelection(selection, edits) };
	}
	if (command === "transpose") {
		if (selection.start !== selection.end) return undefined;
		const units = [...segments.segment(text)];
		let right = units.findIndex((unit) => unit.index >= selection.start);
		if (right === -1 || units[right]?.segment === "\n")
			right = (right === -1 ? units.length : right) - 1;
		const leftUnit = units[right - 1];
		const rightUnit = units[right];
		if (
			!leftUnit ||
			!rightUnit ||
			leftUnit.segment.includes("\n") ||
			rightUnit.segment.includes("\n")
		)
			return undefined;
		return replace(
			leftUnit.index,
			rightUnit.index + rightUnit.segment.length,
			rightUnit.segment + leftUnit.segment,
		);
	}
	if (command === "deleteAllLeft" || command === "deleteAllRight") {
		const from =
			selection.start === 0
				? 0
				: text.lastIndexOf("\n", selection.start - 1) + 1;
		const newline = text.indexOf("\n", selection.end);
		return command === "deleteAllLeft"
			? replace(from, selection.end, "")
			: replace(
					selection.start,
					newline === -1 ? text.length : newline,
					"",
				);
	}
	if (
		[
			"upperCase",
			"lowerCase",
			"titleCase",
			"camelCase",
			"pascalCase",
			"snakeCase",
			"kebabCase",
		].includes(command)
	) {
		const selected =
			selection.start === selection.end
				? wordRange(text, selection.start)
				: { from: selection.start, to: selection.end };
		const original = text.slice(selected.from, selected.to);
		if (!original) return undefined;
		const words =
			original
				.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
				.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
				.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
		const capital = (value: string): string => {
			const [first, ...rest] = [...value];
			return (first?.toUpperCase() ?? "") + rest.join("").toLowerCase();
		};
		let value = original;
		if (command === "upperCase") value = original.toUpperCase();
		if (command === "lowerCase") value = original.toLowerCase();
		if (command === "titleCase")
			value = original.replace(/[\p{L}\p{M}\p{N}]+/gu, capital);
		if (command === "camelCase" || command === "pascalCase")
			value = words
				.map((word, index) =>
					index || command === "pascalCase"
						? capital(word)
						: word.toLowerCase(),
				)
				.join("");
		if (command === "snakeCase" || command === "kebabCase")
			value = words
				.map((word) => word.toLowerCase())
				.join(command === "snakeCase" ? "_" : "-");
		return replace(
			selected.from,
			selected.to,
			value,
			selection.start !== selection.end,
		);
	}
	const buffer = new TextBuffer(text);
	const first = buffer.getPositionAt(selection.start).line;
	let last = buffer.getPositionAt(selection.end).line;
	if (
		selection.end > selection.start &&
		buffer.getPositionAt(selection.end).column === 1
	)
		last--;
	if (command !== "joinLines" && selection.start === selection.end) {
		last = buffer.getLineCount();
		if (last > 1 && text.endsWith("\n")) last--;
	}
	const firstLine =
		command !== "joinLines" && selection.start === selection.end
			? 1
			: first;
	if (command === "joinLines" && first === last)
		last = Math.min(buffer.getLineCount(), last + 1);
	const from = buffer.getOffsetAt({ line: firstLine, column: 1 });
	const to = buffer.getOffsetAt({
		line: last,
		column: buffer.getLineMaxColumn(last),
	});
	const lines = text.slice(from, to).split("\n");
	if (command === "joinLines") {
		if (lines.length < 2) return undefined;
		const value = lines.reduce(
			(result, line, index) =>
				index
					? result.trimEnd() +
						(result.trim() && line.trim() ? " " : "") +
						line.trimStart()
					: line,
			"",
		);
		const plan = replace(
			from,
			to,
			value,
			selection.start !== selection.end,
		);
		if (selection.start === selection.end) {
			const caret = from + (lines[0]?.trimEnd().length ?? 0);
			return {
				...plan,
				selection: { start: caret, end: caret, direction: "none" },
			};
		}
		return plan;
	}
	if (command === "sortAscending" || command === "sortDescending")
		lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	if (command === "sortDescending" || command === "reverseLines")
		lines.reverse();
	return replace(
		from,
		to,
		(command === "uniqueLines" ? [...new Set(lines)] : lines).join("\n"),
		true,
	);
}
