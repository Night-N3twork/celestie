import type { EditorOptions } from "../api/editor-options";
import type { LanguageEdit } from "../api/languages";
import type { Disposable, TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import { getLineIndent } from "../view/input";
import { wordRange } from "./editing-commands";
import { indentationUnit } from "./indentation-options";
import {
	combinePlans,
	type MultiEditingPlan,
	replacementPlan,
} from "./selections";
import { parseSnippet } from "./snippets";

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
	applyMultiPlan(plan: MultiEditingPlan): void;
	mergeCompletionEdits(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): MultiEditingPlan;
	offerChoices(values: readonly string[]): void;
}
export class SnippetSession implements Disposable {
	private snippetStops: {
		index: number;
		ranges: TrackedRange[];
		choices?: readonly string[];
	}[] = [];
	private snippetIndex = -1;
	constructor(private readonly host: Host) {}
	private get model() {
		return this.host.model();
	}
	insert(
		body: string,
		variables: Readonly<Record<string, string>> = {},
		targets?: readonly TextSelection[],
		extras: readonly LanguageEdit[] = [],
	): void {
		if (!this.host.canEdit()) return;
		this.clear();
		const selected = this.host.getSelection(),
			indent = getLineIndent(this.host.text(), selected.start),
			source = body
				.replace(/\t/g, indentationUnit(this.host.options()))
				.replace(/\n/g, `\n${indent}`);
		const position = this.model.getPositionAtInputOffset(selected.start),
			filename = this.model.uri.path.split("/").at(-1) ?? "",
			word = wordRange(this.host.text(), selected.start),
			date = new Date();
		const parsed = parseSnippet(source, {
			TM_SELECTED_TEXT: this.host
				.text()
				.slice(selected.start, selected.end),
			TM_FILENAME: filename,
			TM_FILENAME_BASE: filename.replace(/\.[^.]+$/, ""),
			TM_DIRECTORY: this.model.uri.path.slice(
				0,
				this.model.uri.path.lastIndexOf("/"),
			),
			TM_FILEPATH: this.model.uri.path,
			TM_CURRENT_LINE: this.model.getLineContent(position.line),
			TM_CURRENT_WORD: this.host.text().slice(word.from, word.to),
			TM_LINE_INDEX: String(position.line - 1),
			TM_LINE_NUMBER: String(position.line),
			CURRENT_YEAR: String(date.getFullYear()),
			CURRENT_MONTH: String(date.getMonth() + 1).padStart(2, "0"),
			CURRENT_DATE: String(date.getDate()).padStart(2, "0"),
			CURRENT_HOUR: String(date.getHours()).padStart(2, "0"),
			CURRENT_MINUTE: String(date.getMinutes()).padStart(2, "0"),
			CURRENT_SECOND: String(date.getSeconds()).padStart(2, "0"),
			UUID: crypto.randomUUID(),
			...variables,
		});
		const basePlan = combinePlans(
			(targets ?? this.host.getSelections()).map((selection) =>
				replacementPlan(selection, parsed.text),
			),
			this.host.text().length,
		);
		const plan = this.host.mergeCompletionEdits(basePlan, extras);
		this.host.applyMultiPlan(plan);
		const groups = new Map<number, TrackedRange[]>();
		for (const selection of plan.selections) {
			const base = selection.end - parsed.text.length;
			for (const stop of parsed.stops) {
				const start = this.model.getPositionAtInputOffset(
						base + stop.from,
					),
					end = this.model.getPositionAtInputOffset(base + stop.to),
					ranges = groups.get(stop.index) ?? [];
				ranges.push(
					this.model.trackRange(
						{
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						{ stickiness: "always" },
					),
				);
				groups.set(stop.index, ranges);
			}
		}
		if (!groups.has(0))
			groups.set(
				0,
				plan.selections.map((selection) => {
					const point = this.model.getPositionAtInputOffset(
						selection.end,
					);
					return this.model.trackRange({
						startLine: point.line,
						startColumn: point.column,
						endLine: point.line,
						endColumn: point.column,
					});
				}),
			);
		this.snippetStops = [...groups]
			.sort(
				([a], [b]) =>
					(a === 0 ? Infinity : a) - (b === 0 ? Infinity : b),
			)
			.map(([index, ranges]) => ({
				index,
				ranges,
				...(parsed.stops.find((stop) => stop.index === index)?.choices
					? {
							choices:
								parsed.stops.find(
									(stop) => stop.index === index,
								)?.choices ?? [],
						}
					: {}),
			}));
		this.snippetIndex = -1;
		this.next(false);
	}
	next(backward: boolean): boolean {
		if (!this.snippetStops.length) return false;
		if (
			this.host.options().readOnly ||
			!this.host.attached() ||
			this.host.isComposing()
		) {
			this.clear();
			return false;
		}
		this.snippetIndex = Math.max(
			0,
			this.snippetIndex + (backward ? -1 : 1),
		);
		const stop = this.snippetStops[this.snippetIndex];
		if (!stop) {
			this.clear();
			return false;
		}
		const values = stop.ranges.flatMap((tracked) => {
			const range = tracked.getRange();
			return range
				? [
						{
							start: this.model.getInputOffsetAt({
								line: range.startLine,
								column: range.startColumn,
							}),
							end: this.model.getInputOffsetAt({
								line: range.endLine,
								column: range.endColumn,
							}),
							direction: "forward" as const,
						},
					]
				: [];
		});
		if (!values.length) {
			this.clear();
			return false;
		}
		this.host.setSelections(values, true);
		if (stop.index === 0) this.clear();
		else if (stop.choices?.length) this.host.offerChoices(stop.choices);
		return true;
	}
	clear(): void {
		for (const stop of this.snippetStops)
			for (const range of stop.ranges) range.dispose();
		this.snippetStops = [];
		this.snippetIndex = -1;
	}
	dispose(): void {
		this.clear();
	}
}
