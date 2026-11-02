import type {
	Disposable,
	HistoryViewState,
	ModelChangeEvent,
} from "../api/types";
import { FindReplace, type SearchEdit } from "../features/find-replace";
import { GoToLine } from "../features/go-to-line";
import { planIndentation, type TextSelection } from "../features/indentation";
import { KeyboardShortcuts } from "../features/keyboard-shortcuts";
import { TextBuffer } from "../model/text-buffer";
import type { TextModel } from "../model/text-model";
import {
	findTextChange,
	getInputLineRange,
	getInputPosition,
	getLineIndent,
	normalizeInputText,
} from "./input";
import { TextRenderer } from "./text-renderer";

export class EditorView implements Disposable {
	readonly shortcuts: KeyboardShortcuts;
	private readonly element: HTMLTextAreaElement;
	private readonly subscription: Disposable;
	private readonly renderer: TextRenderer;
	private readonly cursorLabel: HTMLDivElement;
	private readonly frame: HTMLDivElement;
	private readonly find: FindReplace;
	private readonly goTo: GoToLine;
	private disposed = false;
	private composing = false;
	private pendingSelection: TextSelection | undefined;
	private readonly owner = crypto.randomUUID();
	private groupSequence = 0;
	private beforeInputState: HistoryViewState | undefined;
	private lastSelection: TextSelection = {
		start: 0,
		end: 0,
		direction: "none",
	};
	private typingGroup:
		| {
				id: string;
				kind: string;
				time: number;
				version: number;
				selection: TextSelection;
		  }
		| undefined;
	private compositionGroup: string | undefined;
	private compositionEndText = "";
	private compositionEndTime = 0;

	constructor(
		container: HTMLElement,
		private readonly model: TextModel,
	) {
		const document = container.ownerDocument;
		this.frame = document.createElement("div");
		this.frame.className = "editor-view-frame";
		container.appendChild(this.frame);
		this.element = document.createElement("textarea");
		this.element.className = "editor-native-input";
		this.element.setAttribute("aria-label", "Editor");
		this.element.setAttribute(
			"aria-description",
			"Tab indents; Shift+Tab outdents. Control or Command Z undoes. Add Shift to redo. Press Escape, then Tab to move focus.",
		);
		this.element.title =
			"Tab: indent · Shift+Tab: outdent · Escape, then Tab: move focus";
		this.element.setAttribute("autocapitalize", "off");
		this.element.setAttribute("autocorrect", "off");
		this.element.spellcheck = false;
		this.element.autocomplete = "off";
		this.element.wrap = "off";
		this.element.value = normalizeInputText(model.getValue());
		this.element.setSelectionRange(0, 0);
		this.renderer = new TextRenderer(this.frame, model, {
			input: this.element,
			padding: 16,
			height: "100%",
			onSelectLine: this.selectLine,
		});
		this.cursorLabel = document.createElement("div");
		this.cursorLabel.className = "editor-cursor-label";
		this.frame.appendChild(this.cursorLabel);
		for (const event of ["click", "keyup", "select", "selectionchange"]) {
			this.element.addEventListener(event, this.updateCursor);
		}
		this.element.addEventListener("input", this.handleInput);
		this.shortcuts = new KeyboardShortcuts(this.element, {
			indent: () => this.indent(),
			outdent: () => this.outdent(),
			undo: () => this.undo(),
			redo: () => this.redo(),
			isComposing: () => this.composing,
			breakHistoryGroup: this.breakHistoryGroup,
		});
		this.find = new FindReplace(
			this.frame,
			{
				onOpen: () => this.goTo.close(false),
				getText: () => this.element.value,
				getSelection: () => this.captureState().selection,
				selectMatch: (match) => {
					this.breakHistoryGroup();
					this.element.setSelectionRange(match.from, match.to);
					this.revealCursor();
					this.updateCursor();
				},
				replace: (edits, expectedText) =>
					this.replaceSearch(edits, expectedText),
				highlight: (matches, current) =>
					this.renderer.setSearchMatches(matches, current),
				focusEditor: () => this.focus(),
			},
			this.shortcuts,
		);
		this.goTo = new GoToLine(
			this.frame,
			{
				onOpen: () => this.find.close(false),
				getText: () => this.element.value,
				getPosition: () =>
					getInputPosition(
						this.element.value,
						this.element.selectionDirection === "backward"
							? this.element.selectionStart
							: this.element.selectionEnd,
					),
				selectOffset: (offset) => {
					this.breakHistoryGroup();
					this.element.setSelectionRange(offset, offset);
					this.revealCursor();
					this.updateCursor();
				},
				focusEditor: () => this.focus(),
			},
			this.shortcuts,
		);
		this.element.addEventListener("beforeinput", this.handleBeforeInput);
		this.element.addEventListener(
			"compositionstart",
			this.handleCompositionStart,
		);
		this.element.addEventListener(
			"compositionend",
			this.handleCompositionEnd,
		);
		document.addEventListener(
			"selectionchange",
			this.handleDocumentSelection,
		);
		this.subscription = model.onDidChangeContent((event) => {
			if (!this.pendingSelection) this.breakHistoryGroup();
			this.render(event);
		});
		this.render();
	}

	focus(): void {
		this.element.focus();
	}

	openFind(replace = false): void {
		this.find.open(replace);
	}

	openGoTo(): void {
		this.goTo.open();
	}

	private replaceSearch(
		edits: readonly SearchEdit[],
		expectedText: string,
	): void {
		if (this.composing || !edits.length) return;
		if (
			this.element.value !== expectedText ||
			normalizeInputText(this.model.getValue()) !== expectedText
		) {
			throw new Error("Document changed. Run the search again.");
		}
		this.breakHistoryGroup();
		const before = this.captureState();
		const first = edits[0];
		const offset = (first?.from ?? 0) + (first?.text.length ?? 0);
		const selection: TextSelection = {
			start: offset,
			end: offset,
			direction: "none",
		};
		const buffer = new TextBuffer(expectedText);
		const eol = this.model.getValue().match(/\r\n|\r|\n/)?.[0] ?? "\n";
		this.pendingSelection = selection;
		try {
			this.model.edit(
				edits.map((edit) => {
					const start = buffer.getPositionAt(edit.from);
					const end = buffer.getPositionAt(edit.to);
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
				{ before, after: { ...before, selection } },
			);
		} finally {
			this.pendingSelection = undefined;
		}
		this.revealCursor();
	}

	indent(): void {
		this.changeIndentation("indent");
	}

	outdent(): void {
		this.changeIndentation("outdent");
	}

	undo(): void {
		if (this.composing) return;
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		this.model.undo();
		this.element.focus({ preventScroll: true });
		this.revealCursor();
	}

	redo(): void {
		if (this.composing) return;
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		this.model.redo();
		this.element.focus({ preventScroll: true });
		this.revealCursor();
	}

	private readonly breakHistoryGroup = (): void => {
		this.typingGroup = undefined;
	};

	private captureState(): HistoryViewState {
		return {
			owner: this.owner,
			selection: {
				start: this.element.selectionStart,
				end: this.element.selectionEnd,
				direction: this.element.selectionDirection,
			},
			scrollTop: this.element.scrollTop,
			scrollLeft: this.element.scrollLeft,
		};
	}

	private sameSelection(left: TextSelection, right: TextSelection): boolean {
		return (
			left.start === right.start &&
			left.end === right.end &&
			(left.start === left.end || left.direction === right.direction)
		);
	}

	private changeIndentation(direction: "indent" | "outdent"): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.composing) return;
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		const beforeState = this.captureState();
		const before = this.element.value;
		const selection: TextSelection = {
			start: this.element.selectionStart,
			end: this.element.selectionEnd,
			direction: this.element.selectionDirection,
		};
		const plan = planIndentation(before, selection, direction);
		this.element.focus({ preventScroll: true });
		if (plan.edits.length === 0) return;
		this.pendingSelection = plan.selection;
		try {
			let line = 1;
			let lineStart = 0;
			let newline = before.indexOf("\n");
			this.model.edit(
				plan.edits.map((edit) => {
					while (newline !== -1 && newline < edit.from) {
						line++;
						lineStart = newline + 1;
						newline = before.indexOf("\n", lineStart);
					}
					return {
						range: {
							startLine: line,
							startColumn: edit.from - lineStart + 1,
							endLine: line,
							endColumn: edit.to - lineStart + 1,
						},
						text: edit.text,
					};
				}),
				{
					before: beforeState,
					after: { ...beforeState, selection: plan.selection },
				},
			);
		} finally {
			this.pendingSelection = undefined;
		}
		if (selection.start === selection.end) this.revealCursor();
	}

	private readonly updateCursor = (): void => {
		const selection = this.captureState().selection;
		if (
			this.typingGroup &&
			!this.sameSelection(this.typingGroup.selection, selection)
		)
			this.breakHistoryGroup();
		this.lastSelection = selection;
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;
		const position = getInputPosition(this.element.value, offset);
		this.cursorLabel.textContent = `Ln ${position.line}, Col ${position.column}`;
		this.renderer.setActiveLine(position.line);
	};

	private readonly handleDocumentSelection = (): void => {
		if (this.element.ownerDocument.activeElement === this.element)
			this.updateCursor();
	};

	private readonly handleCompositionStart = (): void => {
		this.breakHistoryGroup();
		this.compositionGroup = `${this.owner}:${++this.groupSequence}`;
		this.beforeInputState = this.captureState();
		this.composing = true;
	};
	private readonly handleCompositionEnd = (event: CompositionEvent): void => {
		this.composing = false;
		this.compositionEndText = event.data;
		this.compositionEndTime = Date.now();
		this.breakHistoryGroup();
		this.updateCursor();
	};

	private readonly selectLine = (line: number): void => {
		const { from, to } = getInputLineRange(this.element.value, line);
		this.element.focus({ preventScroll: true });
		this.element.setSelectionRange(from, to, "backward");
		this.updateCursor();
	};

	private readonly handleBeforeInput = (event: InputEvent): void => {
		if (event.defaultPrevented) return;
		this.beforeInputState = this.captureState();
		if (
			!this.composing &&
			!event.isComposing &&
			event.cancelable &&
			(event.inputType === "historyUndo" ||
				event.inputType === "historyRedo")
		) {
			event.preventDefault();
			if (event.inputType === "historyUndo") this.undo();
			else this.redo();
			return;
		}
		if (
			this.composing ||
			event.isComposing ||
			!event.cancelable ||
			event.defaultPrevented
		)
			return;
		if (
			event.inputType !== "insertLineBreak" &&
			event.inputType !== "insertParagraph"
		)
			return;
		event.preventDefault();
		const { selectionStart, selectionEnd, value } = this.element;
		const indent = getLineIndent(value, selectionStart);
		this.element.setRangeText(
			`\n${indent}`,
			selectionStart,
			selectionEnd,
			"end",
		);
		this.handleInput();
		this.revealCursor();
	};

	private revealCursor(): void {
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;
		const position = getInputPosition(this.element.value, offset);
		const top = 16 + (position.line - 1) * 24;
		if (top < this.element.scrollTop + 16)
			this.element.scrollTop = Math.max(0, top - 16);
		else if (
			top + 24 >
			this.element.scrollTop + this.element.clientHeight - 16
		) {
			this.element.scrollTop = top + 24 + 16 - this.element.clientHeight;
		}
		const prefix = this.element.value.slice(
			offset - position.column + 1,
			offset,
		);
		const context = this.element.ownerDocument
			.createElement("canvas")
			.getContext("2d");
		if (context) context.font = "16px monospace";
		const tabWidth = 4 * (context?.measureText(" ").width ?? 8);
		let width = 0;
		const runs = prefix.split("\t");
		for (let index = 0; index < runs.length; index++) {
			const run = runs[index] ?? "";
			width += context?.measureText(run).width ?? run.length * 8;
			if (index < runs.length - 1)
				width = (Math.floor(width / tabWidth) + 1) * tabWidth;
		}
		const left = 16 + width;
		if (left < this.element.scrollLeft + 16)
			this.element.scrollLeft = Math.max(0, left - 16);
		else if (
			left + 16 >
			this.element.scrollLeft + this.element.clientWidth
		) {
			this.element.scrollLeft = left + 16 - this.element.clientWidth;
		}
		this.renderer.render();
	}

	private readonly handleInput = (event?: Event): void => {
		const input = event as InputEvent | undefined;
		const beforeState = this.beforeInputState ?? {
			...this.captureState(),
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
			if (input.inputType === "historyUndo") this.undo();
			else this.redo();
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
			this.updateCursor();
			if (lineBreak) this.revealCursor();
			return;
		}
		const start = getInputPosition(before, change.from);
		const end = getInputPosition(before, change.to);
		const eol = original.match(/\r\n|\r|\n/)?.[0] ?? "\n";
		const afterState = this.captureState();
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
			group =
				this.compositionGroup ??
				`${this.owner}:${++this.groupSequence}`;
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
					this.sameSelection(
						previous.selection,
						beforeState.selection,
					)
						? previous.id
						: `${this.owner}:${++this.groupSequence}`;
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
			this.render();
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
		this.updateCursor();
		if (lineBreak) this.revealCursor();
	};

	private render(event?: ModelChangeEvent): void {
		const text = normalizeInputText(this.model.getValue());
		const change = findTextChange(this.element.value, text);
		if (change) {
			const mapOffset = (offset: number): number => {
				if (offset < change.from) return offset;
				if (offset > change.to)
					return (
						offset + change.text.length - (change.to - change.from)
					);
				return change.from + change.text.length;
			};
			const start =
				this.pendingSelection?.start ??
				mapOffset(this.element.selectionStart);
			const end =
				this.pendingSelection?.end ??
				mapOffset(this.element.selectionEnd);
			const { selectionDirection, scrollTop, scrollLeft } = this.element;
			this.element.value = text;
			this.element.setSelectionRange(
				start,
				end,
				this.pendingSelection?.direction ?? selectionDirection,
			);
			this.element.scrollTop = scrollTop;
			this.element.scrollLeft = scrollLeft;
		}
		const state = event?.historyState;
		if (state?.owner === this.owner) {
			this.element.setSelectionRange(
				state.selection.start,
				state.selection.end,
				state.selection.direction,
			);
			this.element.scrollTop = state.scrollTop;
			this.element.scrollLeft = state.scrollLeft;
		}
		this.renderer.render();
		this.updateCursor();
		this.find.refresh();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.element.removeEventListener("input", this.handleInput);
		this.find.dispose();
		this.goTo.dispose();
		this.shortcuts.dispose();
		this.element.removeEventListener("beforeinput", this.handleBeforeInput);
		this.element.removeEventListener(
			"compositionstart",
			this.handleCompositionStart,
		);
		this.element.removeEventListener(
			"compositionend",
			this.handleCompositionEnd,
		);
		this.element.ownerDocument.removeEventListener(
			"selectionchange",
			this.handleDocumentSelection,
		);
		for (const event of ["click", "keyup", "select", "selectionchange"]) {
			this.element.removeEventListener(event, this.updateCursor);
		}
		this.subscription.dispose();
		this.renderer.dispose();
		this.cursorLabel.remove();
		this.frame.remove();
	}
}
