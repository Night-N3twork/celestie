import type { TextSelection } from "../api/types";
import { mapOffset } from "../model/change-mapping";
import type { TrackedRange } from "../model/tracked-ranges";
import { mapSelection } from "./editing-plan";
import type { MultiEditingPlan } from "./selections";
import { type SnippetTabstop, transformSnippet } from "./snippets";

export interface SnippetFrame {
	stops: {
		index: number;
		ranges: {
			tracked: TrackedRange;
			metadata: SnippetTabstop;
			instance: number;
		}[];
		choices?: readonly string[];
	}[];
	transforms: {
		tracked: TrackedRange;
		metadata: SnippetTabstop & { transform: string };
		instance: number;
	}[];
	index: number;
	id: string;
}
interface TransformState {
	readonly frames: readonly SnippetFrame[];
	readonly text: string;
	readonly selections: readonly TextSelection[];
	offsets(tracked: TrackedRange): { from: number; to: number } | undefined;
	setRange(tracked: TrackedRange, from: number, to: number): void;
	apply(plan: MultiEditingPlan, group: string): void;
}

export function applySnippetTransforms(state: TransformState): void {
	const frame = state.frames.at(-1),
		stop = frame?.stops[frame.index];
	if (!frame || !stop) return;

	const candidates = state.frames
		.flatMap((current) => {
			const active = current.stops[current.index];
			if (!active) return [];
			const indices = new Set([
				active.index,
				...active.ranges.flatMap((item) => item.metadata.parents),
			]);
			return current.transforms
				.filter((item) => indices.has(item.metadata.index))
				.map((item) => ({ item, current }));
		})
		.sort(
			(a, b) =>
				state.frames.indexOf(b.current) -
					state.frames.indexOf(a.current) ||
				b.item.metadata.parents.length - a.item.metadata.parents.length,
		);
	const updates: {
		from: number;
		to: number;
		text: string;
		item: (typeof frame.transforms)[number];
	}[] = [];
	for (const { item, current } of candidates) {
		const range = state.offsets(item.tracked),
			source = current.stops
				.find((stop) => stop.index === item.metadata.index)
				?.ranges.find((source) => source.instance === item.instance),
			owner = source && state.offsets(source.tracked);
		if (!range || !owner) continue;
		let value = state.text.slice(owner.from, owner.to);
		for (const update of [...updates].sort((a, b) => b.from - a.from))
			if (
				update.from >= owner.from &&
				update.to <= owner.to &&
				(update.item.metadata.parents.includes(item.metadata.index) ||
					(update.from > owner.from && update.to < owner.to))
			)
				value =
					value.slice(0, update.from - owner.from) +
					update.text +
					value.slice(update.to - owner.from);
		const text = transformSnippet(value, item.metadata.transform);
		if (state.text.slice(range.from, range.to) !== text)
			updates.push({ ...range, text, item });
	}
	updates.sort(
		(a, b) =>
			a.from - b.from || a.item.metadata.order - b.item.metadata.order,
	);

	if (!updates.length) return;
	const snapshots = state.frames.flatMap((frame) =>
		frame.stops.flatMap((stop) =>
			stop.ranges.flatMap((item) => {
				const range = state.offsets(item.tracked);
				return range ? [{ ...item, ...range, index: stop.index }] : [];
			}),
		),
	);
	const edits: { from: number; to: number; text: string }[] = [];
	for (const update of updates) {
		const previous = edits.at(-1);
		if (
			previous &&
			previous.from === update.from &&
			(previous.from === previous.to || update.from === update.to)
		) {
			previous.text += update.text;
			previous.to = Math.max(previous.to, update.to);
		} else
			edits.push({
				from: update.from,
				to: update.to,
				text: update.text,
			});
	}
	const changes = edits.map((edit) => ({
		offset: edit.from,
		length: edit.to - edit.from,
		text: edit.text,
	}));
	const selections = state.selections.map((selection) =>
		mapSelection(selection, edits),
	);

	state.apply(
		{
			edits,
			selection: selections[0] ?? {
				start: 0,
				end: 0,
				direction: "none",
			},
			selections,
		},
		`${frame.id}:${stop.index}`,
	);
	for (const snapshot of snapshots) {
		const at = (offset: number, end: boolean) =>
			mapOffset(offset, changes, "before") +
			updates
				.filter(
					(update) =>
						update.from === offset &&
						update.from === update.to &&
						(update.item.metadata.order < snapshot.metadata.order ||
							(end &&
								update.item.metadata.parents.includes(
									snapshot.index,
								))),
				)
				.reduce((n, update) => n + update.text.length, 0);
		state.setRange(
			snapshot.tracked,
			at(snapshot.from, false),
			Math.max(at(snapshot.from, false), at(snapshot.to, true)),
		);
	}
	let delta = 0;
	for (const update of updates) {
		const from = update.from + delta;
		state.setRange(update.item.tracked, from, from + update.text.length);
		delta += update.text.length - (update.to - update.from);
	}
}
