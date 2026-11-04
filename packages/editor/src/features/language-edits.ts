import type { LanguageEdit } from "../api/languages";
import type { TextSelection } from "../api/types";
import { languageEngine } from "../languages/client";
import { mapOffset } from "../model/change-mapping";
import type { TextModel } from "../model/text-model";
import { mapSelection } from "./editing-plan";
import { caret, type MultiEditingPlan } from "./selections";

interface Host {
	model(): TextModel;
	text(): string;
	canEdit(): boolean;
	getSelections(): readonly TextSelection[];
	applyMultiPlan(plan: MultiEditingPlan): void;
}
export class LanguageEdits {
	constructor(private readonly host: Host) {}
	private get model() {
		return this.host.model();
	}
	apply(edits: readonly LanguageEdit[]): void {
		if (!edits.length || !this.host.canEdit()) return;
		const groups = new Map<TextModel, LanguageEdit[]>();
		for (const edit of edits) {
			const model = [this.model, ...languageEngine.getModels()].find(
				(model) => model.uri.toString() === edit.uri,
			);
			if (!model) throw new Error(`Document is not open: ${edit.uri}`);
			if (
				edit.version !== undefined &&
				edit.version !== model.getVersionId()
			)
				throw new Error("The document changed. Run the command again.");
			const length = model.getValue({ eol: "\n" }).length;
			if (
				!Number.isInteger(edit.from) ||
				!Number.isInteger(edit.to) ||
				edit.from < 0 ||
				edit.to < edit.from ||
				edit.to > length
			)
				throw new RangeError("Invalid language edit.");
			const group = groups.get(model) ?? [];
			group.push(edit);
			groups.set(model, group);
		}
		for (const group of groups.values()) {
			group.sort((a, b) => a.from - b.from || a.to - b.to);
			for (let index = 1; index < group.length; index++)
				if ((group[index]?.from ?? 0) < (group[index - 1]?.to ?? 0))
					throw new Error("Language edits overlap.");
		}
		for (const [model, group] of groups) {
			if (model === this.model) {
				const selections = this.host
					.getSelections()
					.map((selection) => mapSelection(selection, group));
				this.host.applyMultiPlan({
					edits: group,
					selection: selections[0] ?? caret(0),
					selections,
				});
			} else
				model.edit(
					group.map((edit) => {
						const start = model.getPositionAtInputOffset(edit.from),
							end = model.getPositionAtInputOffset(edit.to);
						return {
							range: {
								startLine: start.line,
								startColumn: start.column,
								endLine: end.line,
								endColumn: end.column,
							},
							text: edit.text.replace(/\n/g, model.getEOL()),
						};
					}),
				);
		}
	}
	mergeCompletion(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): MultiEditingPlan {
		const local = extras.filter(
			(edit) => edit.uri === this.model.uri.toString(),
		);
		for (const edit of local)
			if (
				(edit.version !== undefined &&
					edit.version !== this.model.getVersionId()) ||
				edit.from < 0 ||
				edit.to < edit.from ||
				edit.to > this.host.text().length
			)
				throw new Error("Completion edits are stale or invalid.");
		const own = plan.edits.map((edit) => ({
			offset: edit.from,
			length: edit.to - edit.from,
			text: edit.text,
		}));
		const mapped = local.map((edit) => ({
			from: mapOffset(edit.from, own, "before"),
			to: mapOffset(edit.to, own, "before"),
			text: edit.text,
		}));
		const selections = plan.selections.map((selection) =>
			mapSelection(selection, mapped),
		);
		const edits = plan.edits.map((edit) => ({ ...edit }));
		for (const edit of local) {
			const replacement = edits.find((value) => value.from === edit.from);
			if (edit.from === edit.to && replacement)
				replacement.text = edit.text + replacement.text;
			else edits.push({ from: edit.from, to: edit.to, text: edit.text });
		}
		edits.sort((a, b) => a.from - b.from || a.to - b.to);
		for (let i = 1; i < edits.length; i++)
			if ((edits[i]?.from ?? 0) < (edits[i - 1]?.to ?? 0))
				throw new Error("Completion edits overlap.");
		this.apply(
			extras.filter((edit) => edit.uri !== this.model.uri.toString()),
		);
		return { edits, selection: selections[0] ?? caret(0), selections };
	}
}
