import type { EditorOptions } from "../api/editor-options";
import type { LanguageEdit } from "../api/languages";
import type { Disposable, TextSelection } from "../api/types";
import { mapOffset } from "../model/change-mapping";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import { getLineIndent } from "../view/input";
import {
	combinePlans,
	type MultiEditingPlan,
	replacementPlan,
} from "./selections";
import { indentSnippet } from "./snippet-indentation";
import {
	applySnippetTransforms,
	type SnippetFrame,
} from "./snippet-transforms";
import { snippetVariables } from "./snippet-variables";
import {
	parseSnippet,
	type SnippetTabstop,
	type SnippetTransform,
} from "./snippets";

interface Host {
	model(): TextModel;
	text(): string;
	options(): EditorOptions;
	attached(): boolean;
	isComposing(): boolean;
	canEdit(): boolean;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	applyMultiPlan(plan: MultiEditingPlan, group?: string): void;
	applyCompletionPlan(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): void;
	mergeCompletionEdits(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): MultiEditingPlan;
	offerChoices(values: readonly string[]): void;
}
export class SnippetSession implements Disposable {
	private frames: SnippetFrame[] = [];
	private busy = 0;
	private sequence = 0;
	private readonly owner = crypto.randomUUID();
	private subscriptions: Disposable[] = [];
	private pendingRanges: {
		tracked: TrackedRange;
		from: number;
		to: number;
	}[] = [];
	constructor(private readonly host: Host) {}
	get active(): boolean {
		return this.frames.length > 0;
	}
	private get frame() {
		return this.frames.at(-1);
	}
	private offsets(
		tracked: TrackedRange,
	): { from: number; to: number } | undefined {
		const range = tracked.getRange();
		return range
			? {
					from: this.model.getInputOffsetAt({
						line: range.startLine,
						column: range.startColumn,
					}),
					to: this.model.getInputOffsetAt({
						line: range.endLine,
						column: range.endColumn,
					}),
				}
			: undefined;
	}
	private track(
		from: number,
		to: number,
		stickiness: "always" | "never" = "always",
	): TrackedRange {
		const start = this.model.getPositionAtInputOffset(from),
			end = this.model.getPositionAtInputOffset(to);
		return this.model.trackRange(
			{
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
			{ stickiness },
		);
	}
	private setRange(tracked: TrackedRange, from: number, to: number): void {
		const start = this.model.getPositionAtInputOffset(from),
			end = this.model.getPositionAtInputOffset(to);
		tracked.setRange({
			startLine: start.line,
			startColumn: start.column,
			endLine: end.line,
			endColumn: end.column,
		});
	}
	beforeEdit(plan: MultiEditingPlan): string | undefined {
		if (this.busy || !this.frame) return;
		const frame = this.frame,
			stop = frame.stops[frame.index];
		if (
			!stop ||
			!plan.edits.every((edit) =>
				stop.ranges.some(({ tracked }) => {
					const range = this.offsets(tracked);
					return (
						range && edit.from >= range.from && edit.to <= range.to
					);
				}),
			)
		) {
			this.clear();
			return;
		}
		for (const item of frame.stops)
			if (item.index !== stop.index) {
				item.ranges = item.ranges.filter(({ tracked, metadata }) => {
					const range = this.offsets(tracked);
					const removed =
						metadata.parents.includes(stop.index) &&
						range &&
						plan.edits.some(
							(edit) =>
								edit.to > edit.from &&
								edit.from <= range.from &&
								edit.to >= range.to,
						);
					if (removed) tracked.dispose();
					return !removed;
				});
			}
		frame.transforms = frame.transforms.filter(({ tracked, metadata }) => {
			const range = this.offsets(tracked);
			const removed =
				metadata.parents.includes(stop.index) &&
				range &&
				plan.edits.some(
					(edit) =>
						edit.to > edit.from &&
						edit.from <= range.from &&
						edit.to >= range.to,
				);
			if (removed) tracked.dispose();
			return !removed;
		});
		const changes = plan.edits.map((edit) => ({
			offset: edit.from,
			length: edit.to - edit.from,
			text: edit.text,
		}));
		const ancestors = new Set(
			stop.ranges.flatMap((range) => range.metadata.parents),
		);
		const inactive = [
			...frame.stops
				.filter(
					(item) =>
						item.index !== stop.index && !ancestors.has(item.index),
				)
				.flatMap((item) => item.ranges),
			...frame.transforms,
		];
		this.pendingRanges = inactive.flatMap((item) => {
			const range = this.offsets(item.tracked),
				owner = stop.ranges.find(
					(source) => source.instance === item.instance,
				);
			if (!range || !owner) return [];
			const empty = range.from === range.to,
				affinity =
					item.metadata.order < owner.metadata.order
						? "before"
						: "after";
			const from = mapOffset(
					range.from,
					changes,
					empty ? affinity : "after",
				),
				to = mapOffset(range.to, changes, empty ? affinity : "before");
			return [{ tracked: item.tracked, from, to: Math.max(from, to) }];
		});
		this.busy++;
		return `${frame.id}:${stop.index}`;
	}
	afterEdit(applied = true): void {
		if (applied)
			for (const range of this.pendingRanges)
				this.setRange(range.tracked, range.from, range.to);
		this.pendingRanges = [];
		if (this.busy) this.busy--;
	}
	private transformCurrent(): void {
		this.busy++;
		try {
			applySnippetTransforms({
				frames: this.frames,
				text: this.host.text(),
				selections: this.host.getSelections(),
				offsets: (range) => this.offsets(range),
				setRange: (range, from, to) => this.setRange(range, from, to),
				apply: (plan, group) => this.host.applyMultiPlan(plan, group),
			});
		} finally {
			this.busy--;
		}
	}

	private get model() {
		return this.host.model();
	}
	insert(
		body: string,
		variables: Readonly<Record<string, string>> = {},
		targets?: readonly TextSelection[],
		extras: readonly LanguageEdit[] = [],
		commitCharacter?: string,
	): void {
		if (!this.host.canEdit()) return;
		const parent = this.frame,
			active = parent?.stops[parent.index];
		const nested =
			!!active &&
			!extras.length &&
			(targets ?? this.host.getSelections()).every((selection) =>
				active.ranges.some(({ tracked }) => {
					const range = this.offsets(tracked);
					return (
						range &&
						selection.start >= range.from &&
						selection.end <= range.to
					);
				}),
			);
		if (!nested) this.clear();
		const selections = targets ?? this.host.getSelections(),
			date = new Date();
		const instances = selections.map((selection, cursor) => {
			let parsed = indentSnippet(
				parseSnippet(body, {
					...snippetVariables(
						this.model,
						this.host.text(),
						selection,
						cursor,
						date,
					),
					...variables,
				}),
				getLineIndent(this.host.text(), selection.start),
				this.host.options(),
			);
			if (commitCharacter && !parsed.text.endsWith(commitCharacter))
				parsed = { ...parsed, text: parsed.text + commitCharacter };
			return parsed;
		});
		const basePlan = combinePlans(
			selections.map((selection, index) =>
				replacementPlan(selection, instances[index]?.text ?? ""),
			),
			this.host.text().length,
		);
		const plan = this.host.mergeCompletionEdits(basePlan, extras);

		const nestedGroup = nested ? this.beforeEdit(plan) : undefined;
		this.busy++;
		let applied = false;
		try {
			this.host.applyCompletionPlan(plan, extras);
			applied = true;
		} finally {
			this.busy--;
			if (nestedGroup) this.afterEdit(applied);
		}
		const groups = new Map<
				number,
				{
					tracked: TrackedRange;
					metadata: SnippetTabstop;
					instance: number;
				}[]
			>(),
			transforms: {
				tracked: TrackedRange;
				metadata: SnippetTransform;
				instance: number;
			}[] = [];
		for (const [index, selection] of plan.selections.entries()) {
			const parsed = instances[index];
			if (!parsed) continue;
			const base = selection.end - parsed.text.length;
			for (const stop of parsed.stops) {
				const ranges = groups.get(stop.index) ?? [];
				ranges.push({
					tracked: this.track(
						base + stop.from,
						base + stop.to,
						stop.index === 0 ? "never" : "always",
					),
					metadata: stop,
					instance: base,
				});
				groups.set(stop.index, ranges);
			}
			for (const stop of parsed.transforms)
				transforms.push({
					tracked: this.track(
						base + stop.from,
						base + stop.to,
						"never",
					),
					metadata: stop,
					instance: base,
				});
		}
		if (!groups.has(0))
			groups.set(
				0,
				plan.selections.map((selection, index) => ({
					tracked: this.track(selection.end, selection.end, "never"),
					metadata: {
						index: 0,
						from: instances[index]?.text.length ?? 0,
						to: instances[index]?.text.length ?? 0,
						parents: [],
						order: Number.MAX_SAFE_INTEGER,
					},
					instance:
						selection.end - (instances[index]?.text.length ?? 0),
				})),
			);
		this.frames.push({
			stops: [...groups]
				.sort(
					([a], [b]) =>
						(a === 0 ? Infinity : a) - (b === 0 ? Infinity : b),
				)
				.map(([index, ranges]) => ({
					index,
					ranges,
					...(ranges[0]?.metadata.choices
						? { choices: ranges[0].metadata.choices }
						: {}),
				})),
			transforms,
			index: -1,
			id: `${this.owner}:snippet:${++this.sequence}`,
		});
		if (!this.subscriptions.length)
			this.subscriptions.push(
				this.model.onDidChangeContent(() => {
					if (!this.busy) this.clear();
				}),
				this.model.onWillDispose(() => this.clear()),
			);

		this.next(false);
	}
	next(backward: boolean): boolean {
		const frame = this.frame;
		if (!frame) return false;
		if (
			this.host.options().readOnly ||
			!this.host.attached() ||
			this.host.isComposing()
		) {
			this.clear();
			return false;
		}
		this.transformCurrent();
		frame.index = Math.max(0, frame.index + (backward ? -1 : 1));
		let stop = frame.stops[frame.index];
		while (stop && !stop.ranges.length) {
			frame.index += backward ? -1 : 1;
			stop = frame.stops[frame.index];
		}
		if (!stop) {
			this.clear();
			return false;
		}
		const values = stop.ranges.flatMap(({ tracked }) => {
			const range = this.offsets(tracked);
			return range
				? [
						{
							start: range.from,
							end: range.to,
							direction: "forward" as const,
						},
					]
				: [];
		});
		if (!values.length) {
			this.clear();
			return false;
		}
		this.busy++;
		try {
			this.host.setSelections(values, true);
		} finally {
			this.busy--;
		}
		if (stop.index === 0) {
			this.frames.pop();
			this.disposeFrame(frame);
			if (!this.frames.length) this.clear();
		} else if (stop.choices?.length) this.host.offerChoices(stop.choices);
		return true;
	}
	selectionChanged(): void {
		if (this.busy || !this.frame) return;
		const stop = this.frame.stops[this.frame.index];
		if (
			!stop ||
			this.host.getSelections().length !== stop.ranges.length ||
			!this.host.getSelections().every((selection) =>
				stop.ranges.some(({ tracked }) => {
					const range = this.offsets(tracked);
					return (
						range &&
						selection.start >= range.from &&
						selection.end <= range.to
					);
				}),
			)
		)
			this.clear();
	}
	private disposeFrame(frame: SnippetFrame): void {
		for (const stop of frame.stops)
			for (const range of stop.ranges) range.tracked.dispose();
		for (const transform of frame.transforms) transform.tracked.dispose();
	}
	clear(): void {
		this.pendingRanges = [];
		for (const frame of this.frames) this.disposeFrame(frame);
		this.frames = [];
		for (const subscription of this.subscriptions.splice(0))
			subscription.dispose();
	}
	dispose(): void {
		this.clear();
	}
}
