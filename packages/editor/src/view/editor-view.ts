import type {
	EditorOptions,
	EditorViewOptions,
	EditorViewState,
} from "../api/editor-options";
import type {
	ContentChange,
	Disposable,
	HistoryViewState,
	ModelChangeEvent,
} from "../api/types";
import { BracketAnalysis } from "../features/bracket-analysis";
import { planBracketInput } from "../features/bracket-editing";
import { EditorClipboard, type TransferProvider } from "../features/clipboard";
import { CommandMenu } from "../features/command-menu";
import { CommandRegistry } from "../features/commands";
import { planBlockComment, planLineComment } from "../features/comments";
import {
	expansionRanges,
	planTextCommand,
	planWordCommand,
	type TextCommand,
} from "../features/editing-commands";
import type { EditingPlan } from "../features/editing-plan";
import { registerEditorActions } from "../features/editor-actions";
import { FindReplace, type SearchEdit } from "../features/find-replace";
import { GoToLine } from "../features/go-to-line";
import { planIndentation, type TextSelection } from "../features/indentation";
import {
	detectIndentation,
	type IndentationOptions,
	planIndentationConversion,
	resolveIndentation,
} from "../features/indentation-options";
import {
	KeyboardShortcuts,
	registerCommentShortcuts,
	registerLineShortcuts,
} from "../features/keyboard-shortcuts";
import { type LineCommand, planLineCommand } from "../features/line-commands";
import {
	getLanguageConfiguration,
	type LanguageConfiguration,
	resolveLanguageConfiguration,
} from "../languages/configuration";
import { mapModelInputOffset, mapOffset } from "../model/change-mapping";
import { rebaseEdit } from "../model/rebase-edit";
import { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
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
	readonly commands = new CommandRegistry();
	private readonly menu: CommandMenu;
	private readonly clipboard: EditorClipboard;
	private options: EditorOptions;
	private readonly optionListeners = new Set<
		(options: EditorOptions) => void
	>();
	private readonly notice: HTMLDivElement;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly selectionHistory: TextSelection[] = [];
	private expandedSelection: TextSelection | undefined;
	private readonly element: HTMLTextAreaElement;
	private readonly modelSubscriptions: Disposable[] = [];
	private model: TextModel;
	private attachedModel: TextModel | null = null;
	private readonly emptyModel = new TextModel("", { register: false });
	private readonly savedModels = new Map<
		TextModel,
		{
			selection: TrackedRange;
			direction: TextSelection["direction"];
			anchor: TrackedRange;
			scrollOffset: number;
			scrollLeft: number;
			subscription: Disposable;
		}
	>();
	private readonly renderer: TextRenderer;
	private readonly cursorLabel: HTMLDivElement;
	private readonly frame: HTMLDivElement;
	private readonly find: FindReplace;
	private readonly goTo: GoToLine;
	private disposed = false;
	private composing = false;
	private deferredComposition:
		| {
				model: TextModel;
				base: string;
				before: HistoryViewState;
				batches: (readonly ContentChange[])[];
				flush: boolean;
		  }
		| undefined;
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
	private analysis: BracketAnalysis | undefined;
	private language: LanguageConfiguration;
	private readonly languageOverride: LanguageConfiguration | undefined;

	constructor(
		container: HTMLElement,
		model: TextModel,
		options: EditorViewOptions = {},
	) {
		this.model = model;
		this.attachedModel = model;
		this.languageOverride = options.languageConfiguration;
		let indentation = resolveIndentation(
			{
				...(options.tabSize !== undefined
					? { tabSize: options.tabSize }
					: {}),
				...(options.insertSpaces !== undefined
					? { insertSpaces: options.insertSpaces }
					: {}),
			},
			model.getOptions(),
		);
		if (options.detectIndentation)
			indentation = detectIndentation(
				normalizeInputText(model.getValue()),
				indentation,
			);
		this.options = {
			...indentation,
			readOnly: options.readOnly ?? false,
			tabFocusMode: options.tabFocusMode ?? false,
		};
		if (
			typeof this.options.readOnly !== "boolean" ||
			typeof this.options.tabFocusMode !== "boolean"
		)
			throw new TypeError("readOnly and tabFocusMode must be booleans.");
		this.language = resolveLanguageConfiguration(
			options.languageConfiguration ??
				getLanguageConfiguration(model.getLanguageId()),
		);
		const modelOptions = model.getOptions();
		if (
			modelOptions.tabSize !== indentation.tabSize ||
			modelOptions.insertSpaces !== indentation.insertSpaces
		)
			model.updateOptions(indentation);
		const document = container.ownerDocument;
		this.frame = document.createElement("div");
		this.frame.className = "editor-view-frame";
		container.appendChild(this.frame);
		this.element = document.createElement("textarea");
		this.element.className = "editor-native-input";
		this.element.setAttribute("aria-label", options.ariaLabel ?? "Editor");
		this.element.setAttribute(
			"aria-description",
			"Tab indents; Shift+Tab outdents. Control or Command Z undoes. Add Shift to redo. Alt Up or Down moves lines; add Shift to duplicate. Control or Command Shift K deletes lines. Control or Command Enter inserts a line below; add Shift for above. Control or Command slash toggles line comments; Shift Alt A toggles block comments. Press Escape, then Tab to move focus.",
		);
		this.element.title =
			"Tab: indent · Shift+Tab: outdent · Escape, then Tab: move focus";
		this.element.setAttribute("autocapitalize", "off");
		this.element.setAttribute("autocorrect", "off");
		this.element.spellcheck = false;
		this.element.autocomplete = "off";
		this.element.wrap = "off";
		this.element.readOnly = this.options.readOnly;
		this.element.setAttribute(
			"aria-readonly",
			String(this.options.readOnly),
		);
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
		this.notice = document.createElement("div");
		this.notice.className = "editor-notice";
		this.notice.setAttribute("role", "status");
		this.notice.hidden = true;
		this.frame.append(this.notice);
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
			isComposing: () => this.isComposing,
			breakHistoryGroup: this.breakHistoryGroup,
			announce: (message) => this.announce(message),
			isReadOnly: () => this.options.readOnly || !this.attachedModel,
		});
		this.shortcuts.setTabFocusMode(
			this.options.tabFocusMode || this.options.readOnly,
		);
		this.renderer.setTabSize(this.options.tabSize);
		registerCommentShortcuts(this.shortcuts, {
			line: () => this.toggleLineComment(),
			block: () => this.toggleBlockComment(),
		});
		registerLineShortcuts(this.shortcuts, (command) =>
			this.runLineCommand(command),
		);
		this.find = new FindReplace(
			this.frame,
			{
				onOpen: () => {
					this.goTo.close(false);
					this.menu.close(false);
				},
				canReplace: () =>
					!!this.attachedModel &&
					!this.options.readOnly &&
					!this.composing &&
					!this.deferredComposition,
				trackSelection: (selection) => this.trackSelection(selection),
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
				onOpen: () => {
					this.find.close(false);
					this.menu.close(false);
				},
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
		this.clipboard = new EditorClipboard(
			this.element,
			{
				consumeChord: (key) =>
					this.shortcuts.consumeClipboardChord(key),
				getText: () => this.element.value,
				getSelection: () => this.captureState().selection,
				isReadOnly: () => this.options.readOnly || !this.attachedModel,
				isComposing: () => this.isComposing,
				apply: (plan) => this.applyEditingPlan(plan),
				focus: () => this.focus(),
				announce: (message) => this.announce(message),
				offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
				getTabSize: () => this.options.tabSize,
			},
			this.language,
		);
		this.menu = new CommandMenu(this.frame, this.commands, this.shortcuts, {
			focus: () => this.focus(),
			onOpen: () => {
				this.find.close(false);
				this.goTo.close(false);
				this.breakHistoryGroup();
			},
			announce: (message) => this.announce(message),
		});
		registerEditorActions(this);
		this.element.addEventListener("contextmenu", this.handleContextMenu);
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
		this.bindModel(model);
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

	getModel(): TextModel | null {
		return this.attachedModel;
	}
	setModel(model: TextModel | null): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.composing || this.deferredComposition)
			throw new Error("Finish composition before switching documents.");
		this.switchModel(model, true);
	}
	private bindModel(model: TextModel): void {
		this.modelSubscriptions.push(
			model.onDidChangeContent((event) => {
				this.selectionHistory.length = 0;
				this.expandedSelection = undefined;
				if (!this.pendingSelection) this.breakHistoryGroup();
				if (
					(this.composing || this.deferredComposition) &&
					!this.pendingSelection
				) {
					this.deferredComposition ??= {
						model,
						base: this.element.value,
						before: this.captureState(),
						batches: [],
						flush: false,
					};
					this.deferredComposition.batches.push(
						event.inputChanges ?? [],
					);
					this.deferredComposition.flush ||= event.flush;
					this.frame.classList.add("editor-composition-pending");
					if (event.flush) this.find.close(false);
					return;
				}
				if (event.flush) this.find.close(false);
				this.render(event);
				if (event.historyTruncated)
					this.announce(
						"This edit exceeded the document's undo storage limit.",
					);
			}),
			model.onDidChangeOptions((options) =>
				this.updateOptions({
					tabSize: options.tabSize,
					insertSpaces: options.insertSpaces,
				}),
			),
			model.onDidChangeLanguage(() => this.updateLanguage()),
			model.onWillDispose(() => {
				this.composing = false;
				this.switchModel(null, false);
			}),
			model.attachView(this.owner),
		);
	}
	private updateLanguage(): void {
		this.language = resolveLanguageConfiguration(
			this.languageOverride ??
				getLanguageConfiguration(this.model.getLanguageId()),
		);
		this.analysis = undefined;
		this.clipboard.setLanguageConfiguration(this.language);
		this.updateCursor();
	}
	private switchModel(model: TextModel | null, save: boolean): void {
		if (model === this.attachedModel) return;
		if (model?.isDisposed())
			throw new Error("Cannot attach a disposed model.");
		if (save && this.attachedModel) this.rememberModel(this.attachedModel);
		for (const subscription of this.modelSubscriptions.splice(0))
			subscription.dispose();
		this.find.close(false);
		this.goTo.close(false);
		this.menu.close(false);
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		this.pendingSelection = undefined;
		this.compositionGroup = undefined;
		this.compositionEndText = "";
		this.deferredComposition = undefined;
		this.frame.classList.remove("editor-composition-pending");
		this.selectionHistory.length = 0;
		this.expandedSelection = undefined;
		this.attachedModel = model;
		this.model = model ?? this.emptyModel;
		this.analysis = undefined;
		this.element.value = normalizeInputText(this.model.getValue());
		this.element.setSelectionRange(0, 0);
		this.element.scrollTop = 0;
		this.element.scrollLeft = 0;
		this.renderer.setModel(this.model);
		if (model) {
			this.bindModel(model);
			const options = model.getOptions();
			this.updateOptions({
				tabSize: options.tabSize,
				insertSpaces: options.insertSpaces,
			});
			const state = this.savedModels.get(model);
			if (state) {
				const range = state.selection.getRange();
				const anchor = state.anchor.getRange();
				if (range)
					this.element.setSelectionRange(
						model.getInputOffsetAt({
							line: range.startLine,
							column: range.startColumn,
						}),
						model.getInputOffsetAt({
							line: range.endLine,
							column: range.endColumn,
						}),
						state.direction,
					);
				if (anchor)
					this.element.scrollTop = Math.max(
						0,
						16 + (anchor.startLine - 1) * 24 + state.scrollOffset,
					);
				if (range) this.element.scrollLeft = state.scrollLeft;
				this.releaseSavedModel(model);
			}
		}
		this.element.readOnly = this.options.readOnly || !model;
		this.element.setAttribute(
			"aria-readonly",
			String(this.element.readOnly),
		);
		this.shortcuts.setTabFocusMode(
			this.options.tabFocusMode || this.element.readOnly,
		);
		this.updateLanguage();
		this.render();
	}
	private rememberModel(model: TextModel): void {
		this.releaseSavedModel(model);
		const selection = this.captureState().selection;
		const start = model.getPositionAtInputOffset(selection.start);
		const end = model.getPositionAtInputOffset(selection.end);
		const line = Math.max(
			1,
			Math.min(
				model.getLineCount(),
				Math.floor(Math.max(0, this.element.scrollTop - 16) / 24) + 1,
			),
		);
		const range = model.trackRange(
			{
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
			{ stickiness: "never" },
		);
		const anchor = model.trackRange(
			{ startLine: line, startColumn: 1, endLine: line, endColumn: 1 },
			{ stickiness: "after" },
		);
		const subscription = model.onWillDispose(() =>
			this.releaseSavedModel(model),
		);
		this.savedModels.set(model, {
			selection: range,
			direction: selection.direction,
			anchor,
			scrollOffset: this.element.scrollTop - (16 + (line - 1) * 24),
			scrollLeft: this.element.scrollLeft,
			subscription,
		});
	}
	private releaseSavedModel(model: TextModel): void {
		const state = this.savedModels.get(model);
		if (!state) return;
		state.selection.dispose();
		state.anchor.dispose();
		state.subscription.dispose();
		this.savedModels.delete(model);
	}
	private trackSelection(selection: TextSelection): {
		getRange(): { from: number; to: number } | undefined;
		dispose(): void;
	} {
		const model = this.model;
		const start = model.getPositionAtInputOffset(selection.start);
		const end = model.getPositionAtInputOffset(selection.end);
		const tracked = model.trackRange(
			{
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
			{ stickiness: "always" },
		);
		return {
			getRange: () => {
				const range = tracked.getRange();
				return range
					? {
							from: model.getInputOffsetAt({
								line: range.startLine,
								column: range.startColumn,
							}),
							to: model.getInputOffsetAt({
								line: range.endLine,
								column: range.endColumn,
							}),
						}
					: undefined;
			},
			dispose: () => tracked.dispose(),
		};
	}
	saveViewState(): EditorViewState {
		const state = this.captureState();
		return {
			...(this.attachedModel
				? { modelUri: this.attachedModel.uri.toString() }
				: {}),
			selection: { ...state.selection },
			scrollTop: state.scrollTop,
			scrollLeft: state.scrollLeft,
		};
	}
	restoreViewState(state: EditorViewState): boolean {
		if (
			!this.attachedModel ||
			this.composing ||
			(state.modelUri &&
				state.modelUri !== this.attachedModel.uri.toString())
		)
			return false;
		const { start, end, direction } = state.selection;
		if (
			![start, end, state.scrollTop, state.scrollLeft].every(
				Number.isFinite,
			) ||
			start > end ||
			!["forward", "backward", "none"].includes(direction)
		)
			throw new Error("Invalid editor view state.");
		this.breakHistoryGroup();
		this.element.setSelectionRange(
			Math.max(0, Math.min(this.element.value.length, start)),
			Math.max(0, Math.min(this.element.value.length, end)),
			direction,
		);
		this.element.scrollTop = Math.max(0, state.scrollTop);
		this.element.scrollLeft = Math.max(0, state.scrollLeft);
		this.updateCursor();
		this.renderer.render();
		return true;
	}

	getOptions(): EditorOptions {
		return Object.freeze({ ...this.options });
	}
	getSelection(): TextSelection {
		return this.captureState().selection;
	}
	get isComposing(): boolean {
		return this.composing || !!this.deferredComposition;
	}
	get canUndo(): boolean {
		return this.model.canUndo();
	}
	get canRedo(): boolean {
		return this.model.canRedo();
	}

	onDidChangeOptions(listener: (options: EditorOptions) => void): Disposable {
		if (this.disposed) throw new Error("Editor view disposed.");
		this.optionListeners.add(listener);
		return { dispose: () => this.optionListeners.delete(listener) };
	}

	updateOptions(options: Partial<EditorOptions>): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.composing || this.deferredComposition) {
			this.announce(
				"Finish composing text before changing editor options.",
			);
			return;
		}
		const indentation = resolveIndentation({
			tabSize: options.tabSize ?? this.options.tabSize,
			insertSpaces: options.insertSpaces ?? this.options.insertSpaces,
		});
		const next = { ...this.options, ...options, ...indentation };
		if (
			typeof next.readOnly !== "boolean" ||
			typeof next.tabFocusMode !== "boolean"
		)
			throw new TypeError("readOnly and tabFocusMode must be booleans.");
		if (
			next.tabSize === this.options.tabSize &&
			next.insertSpaces === this.options.insertSpaces &&
			next.readOnly === this.options.readOnly &&
			next.tabFocusMode === this.options.tabFocusMode
		)
			return;
		this.options = next;
		this.breakHistoryGroup();
		this.element.readOnly = next.readOnly || !this.attachedModel;
		this.element.setAttribute(
			"aria-readonly",
			String(this.element.readOnly),
		);
		this.shortcuts.setTabFocusMode(
			next.tabFocusMode || this.element.readOnly,
		);
		this.renderer.setTabSize(next.tabSize);
		this.find.refresh();
		this.updateCursor();
		if (this.attachedModel) {
			const options = this.attachedModel.getOptions();
			if (
				options.tabSize !== next.tabSize ||
				options.insertSpaces !== next.insertSpaces
			)
				this.attachedModel.updateOptions({
					tabSize: next.tabSize,
					insertSpaces: next.insertSpaces,
				});
		}
		for (const listener of this.optionListeners) {
			try {
				listener(this.getOptions());
			} catch (error) {
				console.error("Editor options listener failed", error);
			}
		}
	}

	detectIndentation(): void {
		this.updateOptions(detectIndentation(this.element.value, this.options));
		this.announce("Indentation detected.");
	}
	convertIndentation(insertSpaces: boolean): void {
		if (!this.canEdit()) return;
		const options: IndentationOptions = {
			tabSize: this.options.tabSize,
			insertSpaces,
		};
		this.applyEditingPlan(
			planIndentationConversion(
				this.element.value,
				this.getSelection(),
				options,
			),
		);
		this.updateOptions(options);
	}

	openCommandPalette(): void {
		this.menu.open();
	}
	openContextMenu(): void {
		const bounds = this.element.getBoundingClientRect();
		const selection = this.getSelection();
		const position = getInputPosition(
			this.element.value,
			selection.direction === "backward"
				? selection.start
				: selection.end,
		);
		this.menu.open({
			x: bounds.left + 16,
			y: Math.max(
				bounds.top,
				Math.min(
					bounds.bottom - 20,
					bounds.top +
						16 +
						position.line * 24 -
						this.element.scrollTop,
				),
			),
		});
	}
	async executeCommand(id: string): Promise<boolean> {
		try {
			const executed = await this.commands.execute(id);
			if (!executed)
				this.announce(
					this.options.readOnly
						? "Editor is read-only or this command is unavailable."
						: "Command is unavailable.",
				);
			return executed;
		} catch (error) {
			this.announce(
				error instanceof Error ? error.message : "Command failed.",
			);
			return false;
		}
	}
	registerPasteProvider(provider: TransferProvider): Disposable {
		return this.clipboard.registerPasteProvider(provider);
	}
	registerDropProvider(provider: TransferProvider): Disposable {
		return this.clipboard.registerDropProvider(provider);
	}
	copy(cut = false): Promise<void> {
		return this.clipboard.copy(cut);
	}
	paste(): Promise<void> {
		return this.clipboard.paste();
	}
	selectAll(): void {
		this.applyEditingPlan({
			edits: [],
			selection: {
				start: 0,
				end: this.element.value.length,
				direction: "forward",
			},
		});
	}
	runTextCommand(command: TextCommand): void {
		this.applyEditingPlan(
			planTextCommand(this.element.value, this.getSelection(), command),
		);
	}
	moveWord(
		direction: -1 | 1,
		action: "move" | "select" | "delete",
		subword = false,
	): void {
		this.applyEditingPlan(
			planWordCommand(
				this.element.value,
				this.getSelection(),
				direction,
				action,
				subword,
			),
		);
	}
	jumpToBracket(select = false): void {
		const selection = this.getSelection();
		const active =
			selection.direction === "backward"
				? selection.start
				: selection.end;
		const [candidate, partner] = this.getAnalysis().matchingAt(active);
		if (candidate === undefined || partner === undefined) {
			this.announce("No matching bracket at the cursor.");
			return;
		}
		const target = partner + (partner > candidate ? 1 : 0);
		const anchor = select
			? selection.direction === "backward"
				? selection.end
				: selection.start
			: target;
		this.applyEditingPlan({
			edits: [],
			selection: {
				start: Math.min(anchor, target),
				end: Math.max(anchor, target),
				direction: target < anchor ? "backward" : "forward",
			},
		});
	}
	expandSelection(shrink = false): void {
		const selection = this.getSelection();
		if (
			!this.expandedSelection ||
			!this.sameSelection(this.expandedSelection, selection)
		)
			this.selectionHistory.length = 0;
		const next = shrink
			? this.selectionHistory.pop()
			: expansionRanges(
					this.element.value,
					selection,
					this.getAnalysis(),
				)[0];
		if (!next) return;
		if (!shrink) this.selectionHistory.push(selection);
		this.applyEditingPlan({ edits: [], selection: next });
		this.expandedSelection = this.getSelection();
	}

	private canEdit(): boolean {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (!this.attachedModel) {
			this.announce("No document is attached.");
			return false;
		}
		if (
			this.options.readOnly ||
			this.composing ||
			this.deferredComposition
		) {
			this.announce(
				this.options.readOnly
					? "Editor is read-only."
					: "Finish composing text before using this command.",
			);
			return false;
		}
		return true;
	}

	private announce(message: string): void {
		if (this.disposed) return;
		if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
		this.notice.textContent = message;
		this.notice.hidden = !message;
		this.noticeTimer = setTimeout(() => {
			this.notice.hidden = true;
		}, 4000);
	}

	private readonly handleContextMenu = (event: MouseEvent): void => {
		if (event.shiftKey || this.composing) return;
		event.preventDefault();
		this.menu.open({ x: event.clientX, y: event.clientY });
	};

	private offsetAtPoint(x: number, y: number): number {
		const bounds = this.element.getBoundingClientRect();
		const buffer = this.model;
		const line = Math.max(
			1,
			Math.min(
				buffer.getLineCount(),
				Math.floor(
					(y - bounds.top + this.element.scrollTop - 16) / 24,
				) + 1,
			),
		);
		const content = buffer.getLineContent(line);
		const context = this.element.ownerDocument
			.createElement("canvas")
			.getContext("2d");
		if (context) context.font = "16px monospace";
		const target = Math.max(
			0,
			x - bounds.left + this.element.scrollLeft - 16,
		);
		const tabWidth =
			this.options.tabSize * (context?.measureText(" ").width ?? 8);
		let width = 0;
		let offset = 0;
		for (const unit of content) {
			const next =
				unit === "\t"
					? (Math.floor(width / tabWidth) + 1) * tabWidth
					: width + (context?.measureText(unit).width ?? 8);
			if (target < (width + next) / 2) break;
			width = next;
			offset += unit.length;
		}
		return buffer.getInputOffsetAt({ line, column: offset + 1 });
	}

	runLineCommand(command: LineCommand): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.composing) return;
		this.breakHistoryGroup();
		this.applyEditingPlan(
			planLineCommand(
				this.element.value,
				this.captureState().selection,
				command,
				this.options,
			),
		);
	}

	toggleLineComment(mode?: "add" | "remove"): void {
		if (this.composing) return;
		this.applyEditingPlan(
			planLineComment(
				this.element.value,
				this.captureState().selection,
				this.language,
				mode,
			),
		);
	}

	toggleBlockComment(): void {
		if (this.composing) return;
		this.applyEditingPlan(
			planBlockComment(
				this.element.value,
				this.captureState().selection,
				this.language,
			),
		);
	}

	private getAnalysis(): BracketAnalysis {
		if (this.analysis?.text !== this.element.value)
			this.analysis = new BracketAnalysis(
				this.element.value,
				this.language,
			);
		return this.analysis;
	}

	private applyEditingPlan(plan: EditingPlan | undefined): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (!plan || this.composing) return;
		if (plan.edits.length && !this.canEdit()) return;
		this.beforeInputState = undefined;
		this.breakHistoryGroup();
		if (plan.edits.length)
			this.replaceSearch(plan.edits, this.element.value, plan.selection);
		else {
			this.element.setSelectionRange(
				plan.selection.start,
				plan.selection.end,
				plan.selection.direction,
			);
			this.updateCursor();
			this.revealCursor();
		}
	}

	private replaceSearch(
		edits: readonly SearchEdit[],
		expectedText: string,
		desiredSelection?: TextSelection,
	): void {
		if (!edits.length || !this.canEdit()) return;
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
				{ before, after: { ...before, selection } },
			);
		} finally {
			this.pendingSelection = undefined;
		}
		this.element.setSelectionRange(
			selection.start,
			selection.end,
			selection.direction,
		);
		this.updateCursor();
		this.revealCursor();
	}

	indent(): void {
		this.changeIndentation("indent");
	}

	outdent(): void {
		this.changeIndentation("outdent");
	}

	undo(): void {
		if (!this.canEdit()) return;
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		this.model.undo();
		this.element.focus({ preventScroll: true });
		this.revealCursor();
	}

	redo(): void {
		if (!this.canEdit()) return;
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
		if (!this.canEdit()) return;
		this.applyEditingPlan(
			planIndentation(
				this.element.value,
				this.getSelection(),
				direction,
				this.options,
			),
		);
		this.element.focus({ preventScroll: true });
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
		this.cursorLabel.textContent = this.attachedModel
			? `Ln ${position.line}, Col ${position.column} · ${this.options.insertSpaces ? "Spaces" : "Tabs"}: ${this.options.tabSize}${this.options.readOnly ? " · Read-only" : ""}${this.options.tabFocusMode ? " · Tab moves focus" : ""}`
			: "No document attached";
		this.renderer.setActiveLine(position.line);
		const matches =
			selection.start === selection.end
				? this.getAnalysis().matchingAt(offset)
				: [];
		this.renderer.setBracketMatches(
			matches.map((match) => getInputPosition(this.element.value, match)),
		);
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
		const deferred = this.deferredComposition;
		if (deferred)
			queueMicrotask(() => this.finishDeferredComposition(deferred));
		else
			queueMicrotask(() => {
				if (this.disposed || this.composing || this.deferredComposition)
					return;
				const options = this.model.getOptions();
				this.updateOptions({
					tabSize: options.tabSize,
					insertSpaces: options.insertSpaces,
				});
			});
		this.updateCursor();
	};

	private finishDeferredComposition(
		deferred: NonNullable<EditorView["deferredComposition"]>,
	): void {
		if (
			this.disposed ||
			this.deferredComposition !== deferred ||
			this.attachedModel !== deferred.model
		)
			return;
		const local = this.element.value;
		const selection = this.captureState().selection;
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
			this.applyEditingPlan({
				edits: [
					{ from: rebased.from, to: rebased.to, text: rebased.text },
				],
				selection: { start, end, direction: selection.direction },
			});
			if (rebased.conflict || deferred.flush)
				this.announce(
					"The document changed during composition. Your new text was inserted while preserving the other changes.",
				);
		}
		const options = this.model.getOptions();
		this.updateOptions({
			tabSize: options.tabSize,
			insertSpaces: options.insertSpaces,
		});
		this.render();
	}

	private readonly selectLine = (line: number): void => {
		const { from, to } = getInputLineRange(this.element.value, line);
		this.element.focus({ preventScroll: true });
		this.element.setSelectionRange(from, to, "backward");
		this.updateCursor();
	};

	private readonly handleBeforeInput = (event: InputEvent): void => {
		if (event.defaultPrevented) return;
		this.beforeInputState = this.captureState();
		if (this.options.readOnly || !this.attachedModel) {
			if (event.cancelable) event.preventDefault();
			this.announce("Editor is read-only.");
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
			if (event.inputType === "historyUndo") this.undo();
			else this.redo();
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
		const plan = planBracketInput(
			this.element.value,
			this.captureState().selection,
			event.inputType,
			event.data,
			this.language,
			this.getAnalysis(),
			this.options,
		);
		if (plan) {
			event.preventDefault();
			this.applyEditingPlan(plan);
		}
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
		const tabWidth =
			this.options.tabSize * (context?.measureText(" ").width ?? 8);
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
		if (this.deferredComposition) {
			this.updateCursor();
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
			this.updateCursor();
			this.announce("Editor is read-only.");
			return;
		}
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
		const eol = this.model.getEOL();
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
		if (event?.flush) {
			this.element.setSelectionRange(0, 0);
			this.element.scrollTop = 0;
			this.element.scrollLeft = 0;
		}
		const text = normalizeInputText(this.model.getValue());
		const change = findTextChange(this.element.value, text);
		if (change) {
			const mapLegacyOffset = (offset: number): number => {
				if (offset < change.from) return offset;
				if (offset > change.to)
					return (
						offset + change.text.length - (change.to - change.from)
					);
				return change.from + change.text.length;
			};
			const transform = (
				offset: number,
				affinity: "before" | "after",
			): number =>
				event?.flush
					? 0
					: event
						? mapModelInputOffset(offset, event, affinity)
						: mapLegacyOffset(offset);
			const start =
				this.pendingSelection?.start ??
				transform(this.element.selectionStart, "after");
			const end =
				this.pendingSelection?.end ??
				transform(
					this.element.selectionEnd,
					this.element.selectionStart === this.element.selectionEnd
						? "after"
						: "before",
				);
			const { selectionDirection, scrollTop, scrollLeft } = this.element;
			let anchoredScrollTop = scrollTop;
			if (
				event &&
				!event.flush &&
				!this.pendingSelection &&
				scrollTop > 0
			) {
				const oldLine =
					Math.floor(Math.max(0, scrollTop - 16) / 24) + 1;
				const anchor = getInputLineRange(
					this.element.value,
					oldLine,
				).from;
				const mapped = mapModelInputOffset(anchor, event, "after");
				anchoredScrollTop = Math.max(
					0,
					scrollTop +
						(getInputPosition(text, mapped).line - oldLine) * 24,
				);
			}
			this.element.value = text;
			this.element.setSelectionRange(
				start,
				Math.max(start, end),
				this.pendingSelection?.direction ?? selectionDirection,
			);
			this.element.scrollTop = anchoredScrollTop;
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
		this.deferredComposition = undefined;
		this.analysis = undefined;
		if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
		this.optionListeners.clear();
		this.selectionHistory.length = 0;
		this.element.removeEventListener("contextmenu", this.handleContextMenu);
		this.clipboard.dispose();
		this.menu.dispose();
		this.commands.dispose();
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
		for (const subscription of this.modelSubscriptions.splice(0))
			subscription.dispose();
		for (const model of [...this.savedModels.keys()])
			this.releaseSavedModel(model);
		this.renderer.dispose();
		this.emptyModel.dispose();
		this.attachedModel = null;
		this.model = this.emptyModel;
		this.element.value = "";
		this.cursorLabel.remove();
		this.frame.remove();
	}
}
