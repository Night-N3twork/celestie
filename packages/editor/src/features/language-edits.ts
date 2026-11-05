import type { LanguageEdit, WorkspaceEdit } from "../api/languages";
import type { TextSelection } from "../api/types";
import { languageEngine } from "../languages/client";
import { mapOffset } from "../model/change-mapping";
import type { TextModel, WorkspaceTextEdit } from "../model/text-model";
import { mapSelection } from "./editing-plan";
import { caret, type MultiEditingPlan } from "./selections";

interface Host {
	workspaceHandler():
		| ((edit: WorkspaceEdit, signal: AbortSignal) => void | Promise<void>)
		| undefined;
	model(): TextModel;
	text(): string;
	canEdit(): boolean;
	getSelections(): readonly TextSelection[];
	applyMultiPlan(plan: MultiEditingPlan): void;
	applyWorkspace(
		batches: readonly WorkspaceTextEdit[],
		selections: readonly TextSelection[],
	): void;
}
export class LanguageEdits {
	private abort = new AbortController();
	constructor(private readonly host: Host) {}
	cancel(): void {
		this.abort.abort();
	}
	applyResult(
		input: readonly LanguageEdit[] | WorkspaceEdit,
	): void | Promise<void> {
		const workspace: WorkspaceEdit =
			"edits" in input ? input : { edits: input };
		if (!workspace.fileOperations?.length) {
			this.apply(workspace.edits);
			return;
		}
		if (!this.host.canEdit()) return;
		const handler = this.host.workspaceHandler();
		if (!handler)
			throw new Error(
				"This edit requests file operations. Supply onWorkspaceEdit to handle the entire workspace edit.",
			);
		const models = [this.model, ...languageEngine.getModels()];
		const edits = workspace.edits.map((edit) => {
			const model = models.find(
				(model) => model.uri.toString() === edit.uri,
			);
			if (
				model &&
				edit.version !== undefined &&
				edit.version !== model.getVersionId()
			)
				throw new Error("The document changed. Run the command again.");
			return Object.freeze({
				...edit,
				...(model
					? { version: edit.version ?? model.getVersionId() }
					: {}),
			});
		});
		this.cancel();
		this.abort = new AbortController();
		return handler(
			Object.freeze({
				edits: Object.freeze(edits),
				fileOperations: Object.freeze(
					workspace.fileOperations.map((operation) =>
						Object.freeze({ ...operation }),
					),
				),
			}),
			this.abort.signal,
		);
	}
	private get model() {
		return this.host.model();
	}
	apply(
		edits: readonly LanguageEdit[],
		desired?: readonly TextSelection[],
	): void {
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
				if (
					(group[index]?.from ?? 0) < (group[index - 1]?.to ?? 0) ||
					(group[index]?.from === group[index - 1]?.from &&
						group[index]?.from === group[index]?.to)
				)
					throw new Error("Language edits overlap.");
		}
		const local = groups.get(this.model) ?? [];
		const selections =
			desired ??
			this.host
				.getSelections()
				.map((selection) => mapSelection(selection, local));
		if (groups.size === 1 && groups.has(this.model)) {
			this.host.applyMultiPlan({
				edits: local,
				selection: selections[0] ?? caret(0),
				selections,
			});
			return;
		}
		this.host.applyWorkspace(
			[...groups].map(([model, group]) => ({
				model,
				version: model.getVersionId(),
				edits: group.map((edit) => {
					const start = model.getPositionAtInputOffset(edit.from),
						end = model.getPositionAtInputOffset(edit.to);
					return {
						range: {
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						text: edit.text.replace(/\r\n|\r|\n/g, model.getEOL()),
					};
				}),
			})),
			selections,
		);
	}
	applyCompletion(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): void {
		this.apply(
			[
				...extras.filter(
					(edit) => edit.uri !== this.model.uri.toString(),
				),
				...plan.edits.map((edit) => ({
					...edit,
					uri: this.model.uri.toString(),
					version: this.model.getVersionId(),
				})),
			],
			plan.selections,
		);
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
		return { edits, selection: selections[0] ?? caret(0), selections };
	}
}
