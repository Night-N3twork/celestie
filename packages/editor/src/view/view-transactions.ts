import type { HistoryViewState, TextSelection } from "../api/types";
import type { EditingPlan } from "../features/editing-plan";
import type { SearchEdit } from "../features/find-replace";
import type { MultiEditingPlan } from "../features/selections";
import { TextModel, type WorkspaceTextEdit } from "../model/text-model";
import { normalizeInputText } from "./input";
import type { InputSurface } from "./input-surface";

interface Host {
	input(): InputSurface;
	model(): TextModel;
	disposed(): boolean;
	composing(): boolean;
	isComposing(): boolean;
	canEdit(): boolean;
	captureState(): HistoryViewState;
	breakHistoryGroup(): void;
	clearBeforeInput(): void;
	clearSnippet(): void;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	writeSelections(values: readonly TextSelection[]): void;
	updateCursor(): void;
	revealCursor(): void;
}
export class ViewTransactions {
	pendingSelection: TextSelection | undefined;
	pendingSelections: readonly TextSelection[] | undefined;
	private groupSequence = 0;
	private multiTyping:
		| {
				id: string;
				kind: string;
				time: number;
				version: number;
				selections: string;
		  }
		| undefined;
	constructor(
		private readonly host: Host,
		private readonly owner: string,
	) {}
	private get element() {
		return this.host.input();
	}
	private get model() {
		return this.host.model();
	}
	nextGroup(): string {
		return `${this.owner}:${++this.groupSequence}`;
	}
	resetTyping(): void {
		this.multiTyping = undefined;
	}
	applyWorkspace(
		batches: readonly WorkspaceTextEdit[],
		selections: readonly TextSelection[],
	): void {
		if (!this.host.canEdit() || this.host.isComposing()) return;
		this.host.clearBeforeInput();
		this.host.breakHistoryGroup();
		const before = this.host.captureState();
		this.pendingSelections = selections;
		this.pendingSelection = selections[0];
		try {
			TextModel.applyWorkspaceEdits(
				batches.map((batch) =>
					batch.model === this.model
						? {
								...batch,
								history: {
									before,
									after: {
										...before,
										selection:
											selections[0] ?? before.selection,
										selections,
									},
								},
							}
						: batch,
				),
			);
		} finally {
			this.pendingSelections = undefined;
			this.pendingSelection = undefined;
		}
		this.host.writeSelections(selections);
		this.host.updateCursor();
		this.host.revealCursor();
	}
	applyMultiPlan(
		plan: MultiEditingPlan,
		inputKind?: string,
		historyGroup?: string,
	): void {
		if (
			this.host.isComposing() ||
			(plan.edits.length && !this.host.canEdit())
		)
			return;
		if (!plan.edits.length) {
			this.host.setSelections(plan.selections, true);
			return;
		}
		const previous = this.multiTyping;
		const group =
			historyGroup ??
			(inputKind
				? previous?.kind === inputKind &&
					previous.version === this.model.getVerId() &&
					Date.now() - previous.time <= 750 &&
					previous.selections ===
						JSON.stringify(this.host.getSelections())
					? previous.id
					: this.nextGroup()
				: undefined);
		this.pendingSelections = plan.selections;
		try {
			this.replaceSearch(
				plan.edits,
				this.element.value,
				plan.selection,
				group,
			);
		} finally {
			this.pendingSelections = undefined;
		}
		this.host.writeSelections(plan.selections);
		if (group && inputKind)
			this.multiTyping = {
				id: group,
				kind: inputKind,
				time: Date.now(),
				version: this.model.getVerId(),
				selections: JSON.stringify(this.host.getSelections()),
			};
		this.host.updateCursor();
		this.host.revealCursor();
	}
	applyEditingPlan(plan: EditingPlan | undefined): void {
		if (this.host.disposed()) throw new Error("Editor view disposed.");
		if (!plan || this.host.composing()) return;
		if (plan.edits.length && !this.host.canEdit()) return;
		this.host.clearBeforeInput();
		this.host.breakHistoryGroup();
		if (plan.edits.length)
			this.applyMultiPlan({ ...plan, selections: [plan.selection] });
		else {
			this.host.writeSelections([plan.selection]);
			this.host.updateCursor();
			this.host.revealCursor();
		}
	}
	replaceSearch(
		edits: readonly SearchEdit[],
		expectedText: string,
		desiredSelection?: TextSelection,
		group?: string,
	): void {
		if (!edits.length || !this.host.canEdit()) return;
		if (
			this.element.value !== expectedText ||
			normalizeInputText(this.model.getValue()) !== expectedText
		) {
			throw new Error("Document changed. Run the search again.");
		}
		this.host.breakHistoryGroup();
		const before = this.host.captureState();
		const first = edits[0];
		const offset = (first?.from ?? 0) + (first?.text.length ?? 0);
		const selection: TextSelection = desiredSelection ?? {
			start: offset,
			end: offset,
			direction: "none",
		};
		const eol = this.model.getEOL();
		this.pendingSelection = selection;
		try {
			this.model.edit(
				edits.map((edit) => {
					const start = this.model.getPositionAtInputOffset(
						edit.from,
					);
					const end = this.model.getPositionAtInputOffset(edit.to);
					return {
						range: {
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						text: edit.text.replace(/\n/g, eol),
					};
				}),
				{
					before,
					after: {
						...before,
						selection,
						selections: this.pendingSelections ?? [selection],
					},
					...(group ? { group } : {}),
				},
			);
		} finally {
			this.pendingSelection = undefined;
		}
		this.element.setSelectionRange(
			selection.start,
			selection.end,
			selection.direction,
		);
		this.host.updateCursor();
		this.host.revealCursor();
	}
	undo(): void {
		if (!this.host.canEdit()) return;
		this.host.breakHistoryGroup();
		this.host.clearBeforeInput();
		this.host.clearSnippet();
		this.model.undo();
		this.element.focus({ preventScroll: true });
		this.host.revealCursor();
	}
	redo(): void {
		if (!this.host.canEdit()) return;
		this.host.breakHistoryGroup();
		this.host.clearBeforeInput();
		this.host.clearSnippet();
		this.model.redo();
		this.element.focus({ preventScroll: true });
		this.host.revealCursor();
	}
}
