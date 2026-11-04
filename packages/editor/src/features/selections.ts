import type { TextSelection } from "../api/types";
import { mapOffset } from "../model/change-mapping";
import { getInputLineRange, getInputPosition } from "../view/input";
import { type EditingPlan, type InputEdit, mapSelection } from "./editing-plan";

export const selectionLimit = 1000;
const graphemeSegments = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});
export const caret = (
	offset: number,
	affinity?: TextSelection["affinity"],
): TextSelection => ({
	start: offset,
	end: offset,
	direction: "none",
	...(affinity ? { affinity } : {}),
});
export const head = (selection: TextSelection): number =>
	selection.direction === "backward" ? selection.start : selection.end;
export const anchor = (selection: TextSelection): number =>
	selection.direction === "backward" ? selection.end : selection.start;
export const directed = (
	from: number,
	to: number,
	affinity?: TextSelection["affinity"],
): TextSelection => ({
	start: Math.min(from, to),
	end: Math.max(from, to),
	direction: to < from ? "backward" : to > from ? "forward" : "none",
	...(affinity ? { affinity } : {}),
});

export function normalizeSelections(
	values: readonly TextSelection[],
	length: number,
): TextSelection[] {
	if (!values.length || values.length > selectionLimit)
		throw new RangeError(`Expected 1–${selectionLimit} selections.`);
	const sorted = values
		.map((value, index) => {
			if (
				!Number.isInteger(value.start) ||
				!Number.isInteger(value.end) ||
				value.start < 0 ||
				value.end < value.start ||
				!["none", "forward", "backward"].includes(value.direction)
			)
				throw new TypeError("Invalid selection.");
			return {
				...value,
				start: Math.min(length, value.start),
				end: Math.min(length, value.end),
				index,
			};
		})
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const result: (TextSelection & { index: number })[] = [];
	for (const value of sorted) {
		const previous = result.at(-1);
		if (
			previous &&
			(value.start < previous.end ||
				(value.start === previous.end &&
					(value.start === value.end ||
						previous.start === previous.end)))
		) {
			const primary = value.index < previous.index ? value : previous;
			result[result.length - 1] = {
				start: previous.start,
				end: Math.max(previous.end, value.end),
				direction: primary.direction,
				...(primary.affinity ? { affinity: primary.affinity } : {}),
				index: Math.min(previous.index, value.index),
			};
		} else result.push(value);
	}
	return result
		.sort((a, b) => a.index - b.index)
		.map(({ start, end, direction, affinity }) => ({
			start,
			end,
			direction,
			...(affinity ? { affinity } : {}),
		}));
}

const changes = (edits: readonly InputEdit[]) =>
	edits.map((edit) => ({
		offset: edit.from,
		length: edit.to - edit.from,
		text: edit.text,
	}));
const sameEdit = (a: InputEdit, b: InputEdit) =>
	a.from === b.from && a.to === b.to && a.text === b.text;
export interface MultiEditingPlan extends EditingPlan {
	readonly selections: readonly TextSelection[];
}

export function combinePlans(
	plans: readonly EditingPlan[],
	length: number,
): MultiEditingPlan {
	const edits: InputEdit[] = [];
	for (const plan of plans)
		for (const edit of plan.edits)
			if (!edits.some((other) => sameEdit(edit, other))) edits.push(edit);
	edits.sort((a, b) => a.from - b.from || a.to - b.to);
	const originalEdits = edits.slice();
	for (let i = 1; i < edits.length; i++) {
		const previous = edits[i - 1],
			edit = edits[i];
		if (!previous || !edit) continue;
		if (
			edit.from < previous.to &&
			previous.text === "" &&
			edit.text === ""
		) {
			edits.splice(i - 1, 2, {
				from: previous.from,
				to: Math.max(previous.to, edit.to),
				text: "",
			});
			i--;
			continue;
		}
		if (
			edit.from < previous.to ||
			(edit.from === previous.from && edit.to === edit.from)
		)
			throw new Error(
				"These commands overlap. Merge the selections before applying the command.",
			);
	}
	const mergedDeletions = edits.length !== originalEdits.length;

	const selections = plans.map((plan) => {
		const own = changes(plan.edits);
		if (mergedDeletions && edits.every((edit) => edit.text === "")) {
			const toOriginal = (offset: number, after: boolean) => {
				let delta = 0,
					boundary: number | undefined;
				for (const change of own) {
					const at = change.offset + delta;
					if (offset < at) break;
					if (offset === at) {
						if (!after) return change.offset;
						boundary = change.offset + change.length;
					}
					delta -= change.length;
				}
				return boundary ?? offset - delta;
			};
			const all = changes(edits);
			const start = mapOffset(
				toOriginal(plan.selection.start, false),
				all,
				"after",
			);
			const end = mapOffset(
				toOriginal(plan.selection.end, true),
				all,
				"after",
			);
			return {
				start,
				end: Math.max(start, end),
				direction: plan.selection.direction,
			};
		}
		const others = changes(
			edits
				.filter(
					(edit) =>
						!plan.edits.some((value) => sameEdit(value, edit)),
				)
				.map((edit) => ({
					from: mapOffset(edit.from, own, "after"),
					to: mapOffset(edit.to, own, "before"),
					text: edit.text,
				})),
		);
		return {
			start: mapOffset(plan.selection.start, others, "after"),
			end: mapOffset(
				plan.selection.end,
				others,
				plan.selection.start === plan.selection.end
					? "after"
					: "before",
			),
			direction: plan.selection.direction,
		};
	});
	const nextLength =
		length +
		edits.reduce(
			(delta, edit) => delta + edit.text.length - (edit.to - edit.from),
			0,
		);
	const normalized = normalizeSelections(selections, nextLength);
	return {
		edits,
		selection: normalized[0] ?? caret(0),
		selections: normalized,
	};
}

export function replacementPlan(
	selection: TextSelection,
	text: string,
): EditingPlan {
	return {
		edits: [{ from: selection.start, to: selection.end, text }],
		selection: caret(selection.start + text.length),
	};
}

export function graphemeOffset(
	text: string,
	offset: number,
	direction: -1 | 1,
): number {
	const start = offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
	const end = text.indexOf("\n", offset);
	if (direction < 0 && offset === start) return Math.max(0, offset - 1);
	const lineEnd = end < 0 ? text.length : end;
	if (direction > 0 && offset === lineEnd)
		return Math.min(text.length, offset + 1);
	let previous = start;
	for (const segment of graphemeSegments.segment(
		text.slice(start, lineEnd),
	)) {
		const position = start + segment.index;
		if (direction < 0 && position >= offset) return previous;
		if (direction > 0 && position > offset) return position;
		previous = position;
	}
	return direction < 0 ? previous : lineEnd;
}

export function visualColumn(text: string, tabSize: number): number {
	let column = 0;
	for (const unit of text)
		column =
			unit === "\t" ? column + tabSize - (column % tabSize) : column + 1;
	return column;
}
export function offsetAtColumn(
	text: string,
	column: number,
	tabSize: number,
): number {
	let current = 0,
		offset = 0;
	for (const unit of text) {
		const next =
			unit === "\t"
				? current + tabSize - (current % tabSize)
				: current + 1;
		if (column < (current + next) / 2) break;
		current = next;
		offset += unit.length;
	}
	return offset;
}

export function combineLinePlans(
	text: string,
	selections: readonly TextSelection[],
	planner: (
		selection: TextSelection,
		includeEndLine: boolean,
	) => EditingPlan | undefined,
	transform: "map" | "shift" | "collapse" = "map",
): MultiEditingPlan {
	const groups: {
		first: number;
		last: number;
		indices: number[];
		start: number;
		end: number;
	}[] = [];
	const lines = selections
		.map((selection, index) => ({
			selection,
			index,
			first: getInputPosition(text, selection.start).line,
			last: getInputPosition(
				text,
				selection.end > selection.start &&
					text[selection.end - 1] === "\n"
					? selection.end - 1
					: selection.end,
			).line,
		}))
		.sort((a, b) => a.first - b.first || a.last - b.last);
	for (const value of lines) {
		const previous = groups.at(-1);
		if (previous && value.first <= previous.last + 1) {
			previous.last = Math.max(previous.last, value.last);
			previous.indices.push(value.index);
			previous.start = Math.min(previous.start, value.selection.start);
			previous.end = Math.max(previous.end, value.selection.end);
		} else
			groups.push({
				first: value.first,
				last: value.last,
				indices: [value.index],
				start: value.selection.start,
				end: value.selection.end,
			});
	}
	const plans: EditingPlan[] = selections.map((selection) => ({
		edits: [],
		selection,
	}));
	for (const group of groups) {
		const primary = group.indices.reduce((a, b) => Math.min(a, b));
		const selection = selections[primary] ?? caret(0);
		const lastRange = getInputLineRange(text, group.last);
		const merged = {
			start: group.start,
			end:
				group.indices.length > 1
					? Math.max(
							group.end,
							lastRange.to -
								(text[lastRange.to - 1] === "\n" ? 1 : 0),
						)
					: group.end,
			direction: selection.direction,
		};
		const plan = planner(merged, group.indices.length > 1);
		if (!plan) continue;
		for (const index of group.indices) {
			const original = selections[index] ?? caret(0);
			const delta = plan.selection.start - merged.start;
			const result =
				transform === "shift"
					? {
							...original,
							start: original.start + delta,
							end: original.end + delta,
						}
					: transform === "collapse"
						? plan.selection
						: mapSelection(original, plan.edits);
			plans[index] = { edits: plan.edits, selection: result };
		}
	}
	return combinePlans(plans, text.length);
}
