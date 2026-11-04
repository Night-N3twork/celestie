import type { EditorOptions } from "../api/editor-options";
import type {
	ContentChange,
	HistoryViewState,
	TextSelection,
} from "../api/types";
import type { BracketAnalysis } from "../features/bracket-analysis";
import { planBracketInput } from "../features/bracket-editing";
import type { EditingPlan } from "../features/editing-plan";
import { graphemeOffset, replacementPlan } from "../features/selections";
import type { LanguageConfiguration } from "../languages/configuration";
import { mapOffset } from "../model/change-mapping";
import { rebaseEdit } from "../model/rebase-edit";
import type { TextModel } from "../model/text-model";
import {
	findTextChange,
	getInputPosition,
	getLineIndent,
	normalizeInputText,
} from "./input";
import type { InputSurface } from "./input-surface";

interface Host {
	input(): InputSurface;
	frame(): HTMLElement;
	model(): TextModel;
	options(): EditorOptions;
	language(): LanguageConfiguration;
	attached(): TextModel | null;
	disposed(): boolean;
	lastSelection(): TextSelection;
	selectionsValue: TextSelection[];
	pendingSelection: TextSelection | undefined;
	resetMultiTyping(): void;
	nextGroup(): string;
	resetCursors(): void;
	announce(message: string): void;
	applyEditingPlan(plan: EditingPlan | undefined): void;
	applyPerSelection(
		planner: (selection: TextSelection) => EditingPlan | undefined,
		inputKind?: string,
	): void;
	captureState(): HistoryViewState;
	getAnalysis(): BracketAnalysis;
	getSelection(): TextSelection;
	redo(): void;
	render(): void;
	revealCursor(): void;
	sameSelection(a: TextSelection, b: TextSelection): boolean;
	undo(): void;
	updateCursor(): void;
	updateOptions(options: Partial<EditorOptions>): void;
	writeSelections(values: readonly TextSelection[]): void;
}
export class NativeInputController {
	composing = false;
	deferredComposition:
		| {
				model: TextModel;
				base: string;
				before: HistoryViewState;
				batches: (readonly ContentChange[])[];
				flush: boolean;
		  }
		| undefined;
	beforeInputState: HistoryViewState | undefined;
	typingGroup:
		| {
				id: string;
				kind: string;
				time: number;
				version: number;
				selection: TextSelection;
		  }
		| undefined;
	compositionGroup: string | undefined;
	compositionEndText = "";
	compositionEndTime = 0;
	constructor(private readonly host: Host) {}
	private get element() {
		return this.host.input();
	}
	private get frame() {
		return this.host.frame();
	}
	private get model() {
		return this.host.model();
	}
	private get options() {
		return this.host.options();
	}
	private get language() {
		return this.host.language();
	}
	private get attachedModel() {
		return this.host.attached();
	}
	private get disposed() {
		return this.host.disposed();
	}
	private get lastSelection() {
		return this.host.lastSelection();
	}
	private get selectionsValue() {
		return this.host.selectionsValue;
	}
	private set selectionsValue(value: TextSelection[]) {
		this.host.selectionsValue = value;
	}
	private get pendingSelection() {
		return this.host.pendingSelection;
	}
	private set pendingSelection(value: TextSelection | undefined) {
		this.host.pendingSelection = value;
	}
	readonly handleBeforeInput = (event: InputEvent): void => {
		if (event.defaultPrevented) return;
		this.beforeInputState = this.host.captureState();
		if (this.options.readOnly || !this.attachedModel) {
			if (event.cancelable) event.preventDefault();
			this.host.announce("Editor is read-only.");
			return;
		}
		if (this.deferredComposition) return;
		if (
			!this.composing &&
			!event.isComposing &&
			event.cancelable &&
			(event.inputType === "historyUndo" ||
				event.inputType === "historyRedo")
		) {
			event.preventDefault();
			if (event.inputType === "historyUndo") this.host.undo();
			else this.host.redo();
			return;
		}
		if (
			this.composing ||
			event.isComposing ||
			(this.compositionGroup &&
				event.data === this.compositionEndText &&
				Date.now() - this.compositionEndTime < 100) ||
			!event.cancelable ||
			event.defaultPrevented
		)
			return;
		if (
			this.selectionsValue.length > 1 ||
			this.options.accessibilitySupport !== "on"
		) {
			const supported =
				event.inputType === "insertText" ||
				event.inputType === "insertLineBreak" ||
				event.inputType === "insertParagraph" ||
				event.inputType === "deleteContentBackward" ||
				event.inputType === "deleteContentForward";
			if (supported) {
				event.preventDefault();
				this.host.applyPerSelection(
					(selection) => {
						const bracket = planBracketInput(
							this.element.value,
							selection,
							event.inputType,
							event.data,
							this.language,
							this.host.getAnalysis(),
							this.options,
						);
						if (bracket) return bracket;
						if (event.inputType.startsWith("delete")) {
							const backward =
								event.inputType === "deleteContentBackward";
							const start =
								selection.start === selection.end && backward
									? graphemeOffset(
											this.element.value,
											selection.start,
											-1,
										)
									: selection.start;
							const end =
								selection.start === selection.end && !backward
									? graphemeOffset(
											this.element.value,
											selection.end,
											1,
										)
									: selection.end;
							return replacementPlan(
								{ start, end, direction: selection.direction },
								"",
							);
						}
						return replacementPlan(
							selection,
							event.inputType === "insertText"
								? (event.data ?? "")
								: "\n",
						);
					},
					event.inputType === "insertText" ||
						event.inputType.startsWith("deleteContent")
						? event.inputType
						: undefined,
				);
				return;
			}
		}
		const plan = planBracketInput(
			this.element.value,
			this.host.captureState().selection,
			event.inputType,
			event.data,
			this.language,
			this.host.getAnalysis(),
			this.options,
		);
		if (plan) {
			event.preventDefault();
			this.host.applyEditingPlan(plan);
		}
	};
	readonly handleInput = (event?: Event): void => {
		if (this.deferredComposition) {
			this.host.updateCursor();
			return;
		}
		if (this.options.readOnly || !this.attachedModel) {
			const selection =
				this.beforeInputState?.selection ?? this.lastSelection;
			this.beforeInputState = undefined;
			this.element.value = normalizeInputText(this.model.getValue());
			this.element.setSelectionRange(
				selection.start,
				selection.end,
				selection.direction,
			);
			this.host.updateCursor();
			this.host.announce("Editor is read-only.");
			return;
		}
		const input = event as InputEvent | undefined;
		const beforeState = this.beforeInputState ?? {
			...this.host.captureState(),
			selection: this.lastSelection,
		};
		this.beforeInputState = undefined;
		if (
			input?.inputType === "historyUndo" ||
			input?.inputType === "historyRedo"
		) {
			this.element.value = normalizeInputText(this.model.getValue());
			this.element.setSelectionRange(
				beforeState.selection.start,
				beforeState.selection.end,
				beforeState.selection.direction,
			);
			if (input.inputType === "historyUndo") this.host.undo();
			else this.host.redo();
			return;
		}
		const lineBreak =
			!this.composing &&
			!input?.isComposing &&
			(input?.inputType === "insertLineBreak" ||
				input?.inputType === "insertParagraph");
		if (lineBreak) {
			const caret = this.element.selectionStart;
			if (
				caret === this.element.selectionEnd &&
				this.element.value[caret - 1] === "\n"
			) {
				const indent = getLineIndent(this.element.value, caret - 1);
				if (indent)
					this.element.setRangeText(indent, caret, caret, "end");
			}
		}
		const original = this.model.getValue();
		const before = normalizeInputText(original);
		const change = findTextChange(before, this.element.value);
		if (!change) {
			this.breakHistoryGroup();
			this.host.updateCursor();
			if (lineBreak) this.host.revealCursor();
			return;
		}
		const start = getInputPosition(before, change.from);
		const end = getInputPosition(before, change.to);
		const eol = this.model.getEOL();
		if (this.selectionsValue.length > 1) {
			this.selectionsValue = [this.host.captureState().selection];
			this.host.announce("This native input uses the primary cursor.");
		}
		const afterState = this.host.captureState();
		const time = Date.now();
		const composition =
			this.composing ||
			input?.isComposing ||
			input?.inputType?.includes("Composition") ||
			(this.compositionGroup &&
				input?.data === this.compositionEndText &&
				time - this.compositionEndTime < 100);
		let kind: string | undefined;
		let group: string | undefined;
		if (composition) {
			group = this.compositionGroup ?? this.host.nextGroup();
			this.compositionGroup = group;
		} else {
			this.compositionGroup = undefined;
			if (
				beforeState.selection.start === beforeState.selection.end &&
				afterState.selection.start === afterState.selection.end
			) {
				if (
					input?.inputType === "insertText" &&
					!change.text.includes("\n")
				)
					kind = "typing";
				else if (input?.inputType === "deleteContentBackward")
					kind = "backspace";
				else if (input?.inputType === "deleteContentForward")
					kind = "delete";
			}
			if (kind) {
				const previous = this.typingGroup;
				group =
					previous?.kind === kind &&
					previous.version === this.model.getVerId() &&
					time - previous.time <= 750 &&
					this.host.sameSelection(
						previous.selection,
						beforeState.selection,
					)
						? previous.id
						: this.host.nextGroup();
			}
		}
		this.breakHistoryGroup();
		this.pendingSelection = {
			start: this.element.selectionStart,
			end: this.element.selectionEnd,
			direction: this.element.selectionDirection,
		};
		try {
			this.model.edit(
				[
					{
						range: {
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						text: change.text.replace(/\n/g, eol),
					},
				],
				{
					before: beforeState,
					after: afterState,
					...(group ? { group } : {}),
				},
			);
		} catch (error) {
			this.pendingSelection = undefined;
			this.host.render();
			throw error;
		} finally {
			this.pendingSelection = undefined;
		}
		if (kind && group)
			this.typingGroup = {
				id: group,
				kind,
				time,
				version: this.model.getVerId(),
				selection: afterState.selection,
			};
		this.host.updateCursor();
		if (lineBreak) this.host.revealCursor();
	};
	readonly handleCompositionStart = (): void => {
		this.host.resetCursors();
		if (this.selectionsValue.length > 1) {
			this.host.writeSelections([this.host.getSelection()]);
			this.host.announce("Composition uses the primary cursor.");
		}
		this.breakHistoryGroup();
		this.compositionGroup = this.host.nextGroup();
		this.beforeInputState = this.host.captureState();
		this.composing = true;
	};
	readonly handleCompositionEnd = (event: CompositionEvent): void => {
		this.composing = false;
		this.compositionEndText = event.data;
		this.compositionEndTime = Date.now();
		this.breakHistoryGroup();
		const deferred = this.deferredComposition;
		if (deferred)
			queueMicrotask(() => this.finishDeferredComposition(deferred));
		else
			queueMicrotask(() => {
				if (this.disposed || this.composing || this.deferredComposition)
					return;
				const options = this.model.getOptions();
				this.host.updateOptions({
					tabSize: options.tabSize,
					insertSpaces: options.insertSpaces,
				});
			});
		this.host.updateCursor();
	};
	private finishDeferredComposition(
		deferred: NonNullable<NativeInputController["deferredComposition"]>,
	): void {
		if (
			this.disposed ||
			this.deferredComposition !== deferred ||
			this.attachedModel !== deferred.model
		)
			return;
		const local = this.element.value;
		const selection = this.host.captureState().selection;
		const change = findTextChange(deferred.base, local);
		this.deferredComposition = undefined;
		this.compositionGroup = undefined;
		this.beforeInputState = undefined;
		this.frame.classList.remove("editor-composition-pending");
		const throughForeign = (offset: number): number =>
			deferred.batches.reduce(
				(value, changes) => mapOffset(value, changes, "after"),
				offset,
			);
		this.element.value = normalizeInputText(this.model.getValue());
		const before = deferred.before.selection;
		this.element.setSelectionRange(
			throughForeign(before.start),
			throughForeign(before.end),
			before.direction,
		);
		if (change) {
			const rebased = rebaseEdit(change, deferred.batches);
			const caret = (offset: number): number => {
				if (
					offset >= change.from &&
					offset <= change.from + change.text.length
				)
					return rebased.from + offset - change.from;
				const original =
					offset < change.from
						? offset
						: offset -
							change.text.length +
							(change.to - change.from);
				return mapOffset(
					throughForeign(original),
					[
						{
							offset: rebased.from,
							length: rebased.to - rebased.from,
							text: rebased.text,
						},
					],
					"after",
				);
			};
			const start = caret(selection.start);
			const end = Math.max(start, caret(selection.end));
			this.host.applyEditingPlan({
				edits: [
					{ from: rebased.from, to: rebased.to, text: rebased.text },
				],
				selection: { start, end, direction: selection.direction },
			});
			if (rebased.conflict || deferred.flush)
				this.host.announce(
					"The document changed during composition. Your new text was inserted while preserving the other changes.",
				);
		}
		const options = this.model.getOptions();
		this.host.updateOptions({
			tabSize: options.tabSize,
			insertSpaces: options.insertSpaces,
		});
		this.host.render();
	}
	private readonly breakHistoryGroup = (): void => {
		this.typingGroup = undefined;
		this.host.resetMultiTyping();
	};
	resetHistoryGroup(): void {
		this.breakHistoryGroup();
	}
}
