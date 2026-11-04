import type {
	EditorOptions,
	EditorViewOptions,
	EditorViewState,
} from "../api/editor-options";
import { defaultViewOptions, validateViewOptions } from "../api/editor-options";
import type {
	Analysis,
	Completion,
	Diagnostic,
	LanguageEdit,
	Location,
	Token,
} from "../api/languages";
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
	DecorationCollection,
	diagnosticDecorations,
} from "../features/decorations";
import {
	expansionRanges,
	planTextCommand,
	planWordCommand,
	type TextCommand,
	wordRange,
} from "../features/editing-commands";
import { type EditingPlan, mapSelection } from "../features/editing-plan";
import { registerEditorActions } from "../features/editor-actions";
import { FindReplace, type SearchEdit } from "../features/find-replace";
import { type FoldingRange, FoldingState } from "../features/folding";
import { GoToLine } from "../features/go-to-line";
import { planIndentation, type TextSelection } from "../features/indentation";
import {
	detectIndentation,
	type IndentationOptions,
	indentationUnit,
	planIndentationConversion,
	resolveIndentation,
} from "../features/indentation-options";
import {
	KeyboardShortcuts,
	registerCommentShortcuts,
	registerLineShortcuts,
} from "../features/keyboard-shortcuts";
import { LanguageFeatures } from "../features/language-features";
import { type LineCommand, planLineCommand } from "../features/line-commands";
import {
	caret,
	combineLinePlans,
	combinePlans,
	graphemeOffset,
	type MultiEditingPlan,
	normalizeSelections,
	replacementPlan,
	selectionLimit,
} from "../features/selections";
import { parseSnippet } from "../features/snippets";
import { languageEngine } from "../languages/client";
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
import { InputSurface } from "./input-surface";
import { SelectionController } from "./selection-controller";
import { TextRenderer } from "./text-renderer";

export class EditorView implements Disposable {
	readonly shortcuts: KeyboardShortcuts;
	readonly commands = new CommandRegistry();
	private readonly menu: CommandMenu;
	private readonly clipboard: EditorClipboard;
	private options: EditorOptions;
	private readonly modelListeners = new Set<
		(model: TextModel | null) => void
	>();
	private readonly optionListeners = new Set<
		(options: EditorOptions) => void
	>();
	private readonly notice: HTMLDivElement;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private selectionsValue: TextSelection[] = [caret(0)];
	private pendingSelections: readonly TextSelection[] | undefined;
	private readonly cursors: SelectionController;
	private readonly cursorUndo: TextSelection[][] = [];
	private readonly cursorRedo: TextSelection[][] = [];
	private readonly selectionHistory: TextSelection[] = [];
	private multiExpansion: TextSelection[][] = [];
	private multiExpandedKey = "";
	private expandedSelection: TextSelection | undefined;
	private readonly element: InputSurface;
	private readonly modelSubscriptions: Disposable[] = [];
	private model: TextModel;
	private attachedModel: TextModel | null = null;
	private readonly emptyModel = new TextModel("", { register: false });
	private readonly savedModels = new Map<
		TextModel,
		{
			selection: TrackedRange;
			selections: {
				range: TrackedRange;
				direction: TextSelection["direction"];
				affinity?: TextSelection["affinity"];
			}[];
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
	private readonly languageFeatures: LanguageFeatures;
	private readonly locationHandler: EditorViewOptions["onOpenLocation"];
	private snippetStops: {
		index: number;
		ranges: TrackedRange[];
		choices?: readonly string[];
	}[] = [];
	private snippetIndex = -1;
	private colorWidgets: Disposable[] = [];
	private readonly contentWidgets = new Set<Disposable>();
	private readonly diagnosticOwners = new WeakMap<
		TextModel,
		Map<
			string,
			{ collection: DecorationCollection; values: readonly Diagnostic[] }
		>
	>();
	private readonly modelAssets = new Map<
		TextModel,
		{
			folding: FoldingState;
			collections: Set<DecorationCollection>;
			markers: DecorationCollection;
			subscription: Disposable;
		}
	>();
	private groupSequence = 0;
	private beforeInputState: HistoryViewState | undefined;
	private lastSelection: TextSelection = {
		start: 0,
		end: 0,
		direction: "none",
	};
	private multiTyping:
		| {
				id: string;
				kind: string;
				time: number;
				version: number;
				selections: string;
		  }
		| undefined;
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
		this.locationHandler = options.onOpenLocation;
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
			...defaultViewOptions,
			...options,
			...indentation,
			readOnly: options.readOnly ?? false,
			tabFocusMode: options.tabFocusMode ?? false,
			accessibilitySupport: options.accessibilitySupport ?? "auto",
		};
		if (
			typeof this.options.readOnly !== "boolean" ||
			typeof this.options.tabFocusMode !== "boolean" ||
			!["auto", "on", "off"].includes(this.options.accessibilitySupport)
		)
			throw new TypeError("readOnly and tabFocusMode must be booleans.");
		validateViewOptions(this.options);
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
		this.element = new InputSurface(document.createElement("textarea"));
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
			input: this.element.native,
			padding: 16,
			height: "100%",
			onSelectLine: this.selectLine,
		});
		this.renderer.configure(this.options);
		this.element.attachViewport(this.renderer.viewport);
		this.renderer.setAccessible(this.options.accessibilitySupport === "on");
		this.element.attachViewport(this.renderer.viewport);
		this.element.setAccessible(this.options.accessibilitySupport === "on");
		this.frame.classList.toggle(
			"editor-bounded-input",
			this.options.accessibilitySupport !== "on",
		);
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
		this.shortcuts = new KeyboardShortcuts(this.element.native, {
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
					this.writeSelections([
						{
							start: match.from,
							end: match.to,
							direction: "forward",
						},
					]);
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
					this.writeSelections([caret(offset)]);
					this.revealCursor();
					this.updateCursor();
				},
				focusEditor: () => this.focus(),
			},
			this.shortcuts,
		);
		this.clipboard = new EditorClipboard(
			this.element.native,
			{
				consumeChord: (key) =>
					this.shortcuts.consumeClipboardChord(key),
				getText: () => this.element.value,
				getSelection: () => this.captureState().selection,
				isReadOnly: () => this.options.readOnly || !this.attachedModel,
				isComposing: () => this.isComposing,
				getSelections: () => this.getSelections(),
				apply: (plan) =>
					plan.selections
						? this.applyMultiPlan({
								...plan,
								selections: plan.selections,
							})
						: this.applyEditingPlan(plan),
				focus: () => this.focus(),
				announce: (message) => this.announce(message),
				offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
				getTabSize: () => this.options.tabSize,
			},
			this.language,
			this.renderer.interactionElement,
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
		this.renderer.interactionElement.addEventListener(
			"contextmenu",
			this.handleContextMenu,
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
		this.cursors = new SelectionController(
			this.element.native,
			this.frame,
			{
				getText: () => this.element.value,
				getSelections: () => this.getSelections(),
				setSelections: (values, reveal = false) =>
					this.setSelections(values, reveal),
				offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
				columnWidth: () => this.renderer.columnWidth,
				viewport: () => this.element.viewport,
				pointAtOffset: (offset, affinity) =>
					this.renderer.point(
						this.model.getPositionAtInputOffset(offset),
						affinity,
					).x,
				offsetAtLineX: (line, x) =>
					this.renderer.offsetAtLineX(line, x),
				verticalMove: (offset, rows, x, affinity) =>
					this.renderer.verticalMove(offset, rows, x, affinity),
				visualAffinity: (row, offset) =>
					this.renderer.visualAffinity(row, offset),
				verticalOffset: (offset, rows, x, affinity) =>
					this.renderer.verticalOffset(offset, rows, x, affinity),
				rowBoundary: (offset, end, affinity) =>
					this.renderer.rowBoundary(offset, end, affinity),
				pageRows: () =>
					Math.max(
						1,
						Math.floor(
							this.element.clientHeight / this.options.lineHeight,
						) - 1,
					),
				toggleFold: (line) => this.toggleFold(line),
				visualIndex: (offset) => {
					const position =
						this.model.getPositionAtInputOffset(offset);
					return this.renderer.layout.position(
						position.line,
						position.column,
					).index;
				},
				visualRowCount: () => this.renderer.layout.rowCount,
				offsetAtVisualRowX: (row, x) =>
					this.renderer.verticalOffset(
						this.model.getInputOffsetAt({
							line: this.renderer.layout.row(row).line,
							column: this.renderer.layout.row(row).from + 1,
						}),
						0,
						x,
					),
				isBounded: () => this.options.accessibilitySupport !== "on",
				previewDrop: (offset) => this.renderer.setDropOffset(offset),
				moveSelection: (selection, target, copy) =>
					this.moveSelection(selection, target, copy),
				isComposing: () => this.isComposing,
			},
		);
		this.languageFeatures = new LanguageFeatures({
			frame: this.frame,
			input: this.element.native,
			viewport: this.renderer.interactionElement,
			model: () => this.attachedModel,
			selection: () => this.getSelection(),
			diagnostics: () => this.getDiagnostics(),
			analysisOptions: () => ({
				inlayHints: this.options.inlayHints,
				codeLens: this.options.codeLens,
			}),
			canEdit: () =>
				!!this.attachedModel &&
				!this.options.readOnly &&
				!this.isComposing,
			point: (offset) => {
				const point = this.renderer.point(
						this.model.getPositionAtInputOffset(offset),
					),
					bounds = this.element.getBoundingClientRect();
				return {
					x: bounds.left + point.x - this.element.scrollLeft,
					y: bounds.top + point.y - this.element.scrollTop,
					height: point.height,
				};
			},
			offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
			analysis: (value) => this.setLanguageAnalysis(value),
			apply: (edits) => this.applyLanguageEdits(edits),
			accept: (item) => this.acceptCompletion(item),
			snippet: (body) => this.insertSnippet(body),
			nextSnippet: (backward) => this.nextSnippet(backward),
			cancelSnippet: () => this.clearSnippet(),
			open: (location) => this.openLocation(location),
			announce: (message) => this.announce(message),
		});
		this.languageFeatures.setModel(model);
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

	addContentWidget(
		id: string,
		node: HTMLElement,
		position: import("../api/types").Position,
		placement: "above" | "below" | "inline" = "below",
	): Disposable {
		const model = this.model,
			tracked = model.trackRange({
				startLine: position.line,
				startColumn: position.column,
				endLine: position.line,
				endColumn: position.column,
			});
		let widget: Disposable;
		try {
			widget = this.renderer.addWidget(
				id,
				node,
				() => {
					const range = tracked.getRange();
					return range
						? { line: range.startLine, column: range.startColumn }
						: position;
				},
				placement,
			);
		} catch (error) {
			tracked.dispose();
			throw error;
		}
		let active = true;
		const subscription = model.onWillDispose(() => release());
		const release = () => {
			if (!active) return;
			active = false;
			widget.dispose();
			tracked.dispose();
			subscription.dispose();
			this.contentWidgets.delete(handle);
		};
		const handle = { dispose: release };
		this.contentWidgets.add(handle);
		return handle;
	}

	private setLanguageAnalysis(value: Analysis): void {
		if (this.disposed || !this.attachedModel) return;
		const anchor = this.renderer.captureAnchor();
		this.renderer.setAssistance(
			value.hints ?? [],
			(value.lenses ?? []).map((lens) => ({
				line: this.model.getPositionAtInputOffset(lens.offset).line,
				label: lens.label,
				run: () => {
					this.setSelections([caret(lens.offset)], true);
					void this.executeCommand(lens.command);
				},
			})),
		);
		this.setSyntaxTokens(value.tokens);
		this.setDiagnostics(value.diagnostics);
		this.setFoldingRanges(value.folds);
		for (const widget of this.colorWidgets.splice(0)) widget.dispose();
		this.renderer.restoreAnchor(anchor);
		for (const color of value.colors ?? []) {
			const button = this.frame.ownerDocument.createElement("button");
			button.type = "button";
			button.className = "editor-color-swatch";
			button.style.background = color.color;
			button.title = `Change color ${color.color}`;
			button.setAttribute("aria-label", `Change color ${color.color}`);
			button.onclick = () => {
				this.setSelections(
					[
						{
							start: color.from,
							end: color.to,
							direction: "forward",
						},
					],
					true,
				);
				this.runLanguageCommand("color");
			};
			this.colorWidgets.push(
				this.addContentWidget(
					`color-${color.from}`,
					button,
					this.model.getPositionAtInputOffset(color.from),
					"inline",
				),
			);
		}
	}

	runLanguageCommand(command: string): void {
		void this.languageFeatures.run(command);
	}
	private applyLanguageEdits(edits: readonly LanguageEdit[]): void {
		if (!edits.length || !this.canEdit()) return;
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
				const selections = this.getSelections().map((selection) =>
					mapSelection(selection, group),
				);
				this.applyMultiPlan({
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
	private mergeCompletionEdits(
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
				edit.to > this.element.value.length
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
		this.applyLanguageEdits(
			extras.filter((edit) => edit.uri !== this.model.uri.toString()),
		);
		return { edits, selection: selections[0] ?? caret(0), selections };
	}
	private acceptCompletion(item: Completion): void {
		if (!this.canEdit()) return;
		const primary = this.getSelection(),
			values = this.getSelections().map((selection) => ({
				...selection,
				start: Math.max(0, selection.start + item.from - primary.start),
				end: Math.max(0, selection.end + item.to - primary.end),
			}));
		if (item.snippet)
			this.insertSnippet(
				item.insertText,
				{},
				values,
				item.additionalEdits,
			);
		else
			this.applyMultiPlan(
				this.mergeCompletionEdits(
					combinePlans(
						values.map((selection) =>
							replacementPlan(selection, item.insertText),
						),
						this.element.value.length,
					),
					item.additionalEdits ?? [],
				),
			);
	}

	insertSnippet(
		body: string,
		variables: Readonly<Record<string, string>> = {},
		targets?: readonly TextSelection[],
		extras: readonly LanguageEdit[] = [],
	): void {
		if (!this.canEdit()) return;
		this.clearSnippet();
		const selected = this.getSelection(),
			indent = getLineIndent(this.element.value, selected.start),
			source = body
				.replace(/\t/g, indentationUnit(this.options))
				.replace(/\n/g, `\n${indent}`);
		const position = this.model.getPositionAtInputOffset(selected.start),
			filename = this.model.uri.path.split("/").at(-1) ?? "",
			word = wordRange(this.element.value, selected.start),
			date = new Date();
		const parsed = parseSnippet(source, {
			TM_SELECTED_TEXT: this.element.value.slice(
				selected.start,
				selected.end,
			),
			TM_FILENAME: filename,
			TM_FILENAME_BASE: filename.replace(/\.[^.]+$/, ""),
			TM_DIRECTORY: this.model.uri.path.slice(
				0,
				this.model.uri.path.lastIndexOf("/"),
			),
			TM_FILEPATH: this.model.uri.path,
			TM_CURRENT_LINE: this.model.getLineContent(position.line),
			TM_CURRENT_WORD: this.element.value.slice(word.from, word.to),
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
			(targets ?? this.getSelections()).map((selection) =>
				replacementPlan(selection, parsed.text),
			),
			this.element.value.length,
		);
		const plan = this.mergeCompletionEdits(basePlan, extras);
		this.applyMultiPlan(plan);
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
		this.nextSnippet(false);
	}
	private nextSnippet(backward: boolean): boolean {
		if (!this.snippetStops.length) return false;
		if (this.options.readOnly || !this.attachedModel || this.isComposing) {
			this.clearSnippet();
			return false;
		}
		this.snippetIndex = Math.max(
			0,
			this.snippetIndex + (backward ? -1 : 1),
		);
		const stop = this.snippetStops[this.snippetIndex];
		if (!stop) {
			this.clearSnippet();
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
			this.clearSnippet();
			return false;
		}
		this.setSelections(values, true);
		if (stop.index === 0) this.clearSnippet();
		else if (stop.choices?.length)
			this.languageFeatures.offerSnippetChoices(stop.choices);
		return true;
	}
	private clearSnippet(): void {
		for (const stop of this.snippetStops)
			for (const range of stop.ranges) range.dispose();
		this.snippetStops = [];
		this.snippetIndex = -1;
	}
	private openLocation(location: Location): void {
		if (this.locationHandler) {
			this.locationHandler(location);
			return;
		}
		const model = languageEngine
			.getModels()
			.find((model) => model.uri.toString() === location.uri);
		if (!model) {
			this.languageFeatures.peek(location);
			return;
		}
		if (model !== this.model) this.setModel(model);
		this.setSelections(
			[{ start: location.from, end: location.to, direction: "forward" }],
			true,
		);
		this.focus();
	}

	private assets(model = this.model) {
		let assets = this.modelAssets.get(model);
		if (assets) return assets;
		const collections = new Set<DecorationCollection>();
		const markers = new DecorationCollection(model, () =>
			this.refreshDecorations(model),
		);
		collections.add(markers);
		assets = {
			folding: new FoldingState(model),
			collections,
			markers,
			subscription: model.onWillDispose(() => this.releaseAssets(model)),
		};
		this.modelAssets.set(model, assets);
		return assets;
	}
	private releaseAssets(model: TextModel): void {
		const assets = this.modelAssets.get(model);
		if (!assets) return;
		this.modelAssets.delete(model);
		this.diagnosticOwners.delete(model);
		assets.subscription.dispose();
		assets.folding.dispose();
		for (const collection of assets.collections) collection.dispose();
	}
	private refreshDecorations(model: TextModel): void {
		if (!this.disposed && this.model === model)
			this.renderer.setDecorations(
				[...(this.modelAssets.get(model)?.collections ?? [])].flatMap(
					(collection) => collection.get(),
				),
			);
	}
	createDecorations(): DecorationCollection {
		const model = this.model;
		const collection = new DecorationCollection(
			model,
			() => this.refreshDecorations(model),
			() => this.modelAssets.get(model)?.collections.delete(collection),
		);
		this.assets(model).collections.add(collection);
		return collection;
	}

	setDiagnostics(
		diagnostics: readonly Diagnostic[],
		owner = "language",
	): void {
		if (!owner) throw new TypeError("Diagnostic owner required.");
		let owners = this.diagnosticOwners.get(this.model);
		if (!owners) {
			owners = new Map();
			this.diagnosticOwners.set(this.model, owners);
		}
		let entry = owners.get(owner);
		if (!entry) {
			entry = {
				collection:
					owner === "language"
						? this.assets().markers
						: this.createDecorations(),
				values: [],
			};
			owners.set(owner, entry);
		}
		entry.values = diagnostics.map((diagnostic) => ({ ...diagnostic }));
		entry.collection.set(diagnosticDecorations(this.model, diagnostics));
		if (!diagnostics.length && owner !== "language") {
			entry.collection.dispose();
			owners.delete(owner);
		}
		this.languageFeatures?.updateStatus(this.getDiagnostics());
	}
	getDiagnostics(owner?: string): readonly Diagnostic[] {
		const owners = this.diagnosticOwners.get(this.model);
		if (!owners) return [];
		return [...owners]
			.filter(([key]) => owner === undefined || key === owner)
			.flatMap(([, entry]) =>
				entry.collection.get().flatMap((decoration, index) => {
					const original = entry.values[index];
					if (!original) return [];
					return [
						{
							...original,
							from: this.model.getInputOffsetAt({
								line: decoration.range.startLine,
								column: decoration.range.startColumn,
							}),
							to: this.model.getInputOffsetAt({
								line: decoration.range.endLine,
								column: decoration.range.endColumn,
							}),
						},
					];
				}),
			);
	}

	setSyntaxTokens(tokens: readonly Token[]): void {
		this.renderer.setTokens(tokens);
	}
	setFoldingRanges(ranges: readonly FoldingRange[]): void {
		const anchor = this.renderer.captureAnchor();
		this.assets().folding.set(ranges);
		this.renderer.setFolds(this.assets().folding.get());
		this.renderer.restoreAnchor(anchor);
	}
	toggleFold(line?: number): void {
		const folding = this.assets().folding,
			position = this.model.getPositionAtInputOffset(
				this.getSelection().start,
			);
		const region =
			line === undefined
				? folding
						.get()
						.filter(
							(region) =>
								region.start <= position.line &&
								region.end >= position.line,
						)
						.sort((a, b) => b.start - a.start)[0]
				: folding.get().find((region) => region.start === line);
		if (!region) return;
		folding.toggle(region.start);
		this.renderer.setFolds(folding.get());
		if (
			!region.collapsed &&
			position.line > region.start &&
			position.line <= region.end
		)
			this.setSelections(
				[
					caret(
						this.model.getInputOffsetAt({
							line: region.start,
							column: this.model.getLineMaxColumn(region.start),
						}),
					),
				],
				true,
			);
		this.updateCursor();
	}
	foldAll(collapsed: boolean): void {
		this.assets().folding.all(collapsed);
		this.renderer.setFolds(this.assets().folding.get());
		if (collapsed) {
			const head = this.model.getPositionAtInputOffset(
					this.getSelection().start,
				),
				parent = this.assets()
					.folding.get()
					.find(
						(region) =>
							region.collapsed &&
							head.line > region.start &&
							head.line <= region.end,
					);
			if (parent)
				this.setSelections(
					[
						caret(
							this.model.getInputOffsetAt({
								line: parent.start,
								column: 1,
							}),
						),
					],
					true,
				);
		}
		this.updateCursor();
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
					if (event.flush) {
						this.find.close(false);
						this.clearSnippet();
					}
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
		this.cursors.reset();
		this.multiExpansion.length = 0;
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
		this.selectionsValue = [caret(0)];
		this.cursorUndo.length = 0;
		this.cursorRedo.length = 0;
		this.element.setSelectionRange(0, 0);
		this.element.scrollTop = 0;
		this.element.scrollLeft = 0;
		this.clearSnippet();
		for (const widget of this.colorWidgets.splice(0)) widget.dispose();
		this.languageFeatures.setModel(model);
		this.renderer.setModel(this.model);
		this.renderer.setFolds(this.assets().folding.get());
		this.refreshDecorations(this.model);
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
						this.renderer.lineTop(anchor.startLine) +
							state.scrollOffset,
					);
				if (range) this.element.scrollLeft = state.scrollLeft;
				const values = state.selections.flatMap((value) => {
					const tracked = value.range.getRange();
					return tracked
						? [
								{
									start: model.getInputOffsetAt({
										line: tracked.startLine,
										column: tracked.startColumn,
									}),
									end: model.getInputOffsetAt({
										line: tracked.endLine,
										column: tracked.endColumn,
									}),
									direction: value.direction,
									...(value.affinity
										? { affinity: value.affinity }
										: {}),
								},
							]
						: [];
				});
				if (values.length) this.writeSelections(values);
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
		for (const listener of this.modelListeners) {
			try {
				listener(this.attachedModel);
			} catch (error) {
				console.error("Model listener failed", error);
			}
		}
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
				this.renderer.lineAtScrollOffset(this.element.scrollTop),
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
			selections: this.getSelections().map((value) => {
				const start = model.getPositionAtInputOffset(value.start),
					end = model.getPositionAtInputOffset(value.end);
				return {
					range: model.trackRange(
						{
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						{ stickiness: "never" },
					),
					direction: value.direction,
					...(value.affinity ? { affinity: value.affinity } : {}),
				};
			}),
			direction: selection.direction,
			anchor,
			scrollOffset: this.element.scrollTop - this.renderer.lineTop(line),
			scrollLeft: this.element.scrollLeft,
			subscription,
		});
	}
	private releaseSavedModel(model: TextModel): void {
		const state = this.savedModels.get(model);
		if (!state) return;
		state.selection.dispose();
		for (const value of state.selections) value.range.dispose();
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
			selections: state.selections?.map((selection) => ({
				...selection,
			})) ?? [state.selection],
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
		const selections = normalizeSelections(
			state.selections ?? [state.selection],
			this.element.value.length,
		);
		this.breakHistoryGroup();
		this.cursors.reset();
		this.writeSelections(selections);
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
	getSelections(): readonly TextSelection[] {
		return this.selectionsValue.map((selection) => ({ ...selection }));
	}
	setSelections(values: readonly TextSelection[], reveal = false): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.isComposing) return;
		const next = normalizeSelections(values, this.element.value.length);
		if (JSON.stringify(next) === JSON.stringify(this.selectionsValue))
			return;
		this.cursorUndo.push(
			this.selectionsValue.map((selection) => ({ ...selection })),
		);
		if (this.cursorUndo.length > 100) this.cursorUndo.shift();
		this.cursorRedo.length = 0;
		this.breakHistoryGroup();
		this.writeSelections(next);
		this.updateCursor();
		if (reveal) this.revealCursor();
	}
	private writeSelections(values: readonly TextSelection[]): void {
		this.selectionsValue = normalizeSelections(
			values,
			this.element.value.length,
		);
		const selection = this.selectionsValue[0] ?? caret(0);
		this.element.setSelectionRange(
			selection.start,
			selection.end,
			selection.direction,
		);
	}
	cursorHistory(redo = false): void {
		if (this.isComposing) return;
		const from = redo ? this.cursorRedo : this.cursorUndo,
			to = redo ? this.cursorUndo : this.cursorRedo;
		const next = from.pop();
		if (!next) return;
		this.cursors.reset();
		to.push(this.selectionsValue);
		this.writeSelections(next);
		this.updateCursor();
		this.revealCursor();
	}
	addCursor(direction: -1 | 1): void {
		if (!this.isComposing) this.cursors.addVertical(direction);
	}
	columnSelect(direction: "Up" | "Down" | "Left" | "Right"): void {
		if (!this.isComposing) this.cursors.column(direction);
	}
	selectOccurrences(all = false): void {
		if (this.isComposing) return;
		const text = this.element.value,
			primary = this.getSelection();
		if (primary.start === primary.end) {
			const range = wordRange(text, primary.start);
			if (range.from === range.to) return;
			this.setSelections(
				[
					{ start: range.from, end: range.to, direction: "forward" },
					...this.selectionsValue.slice(1),
				],
				true,
			);
			if (!all) return;
		}
		const selection = this.getSelection(),
			needle = text.slice(selection.start, selection.end);
		if (!needle) return;
		const values = all ? [selection] : [...this.selectionsValue];
		const start = all ? 0 : selection.end;
		const find = (from: number, to: number) => {
			let offset = from;
			while (offset <= to && values.length < selectionLimit) {
				const match = text.indexOf(needle, offset);
				if (match < 0 || match + needle.length > to) break;
				if (
					!values.some(
						(value) =>
							match < value.end &&
							match + needle.length > value.start,
					)
				) {
					const next: TextSelection = {
						start: match,
						end: match + needle.length,
						direction: "forward",
					};
					if (all) values.push(next);
					else values.unshift(next);
					if (!all) return true;
				}
				offset = match + needle.length;
			}
			return false;
		};
		if (!find(start, text.length) && !all) find(0, start);
		this.setSelections(values, true);
		this.announce(
			`${this.selectionsValue.length} selections${values.length === selectionLimit ? " (selection limit reached)" : ""}.`,
		);
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

	onDidChangeModel(listener: (model: TextModel | null) => void): Disposable {
		if (this.disposed) throw new Error("Editor view disposed.");
		this.modelListeners.add(listener);
		return {
			dispose: () => {
				this.modelListeners.delete(listener);
			},
		};
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
		validateViewOptions(next);
		if (
			typeof next.readOnly !== "boolean" ||
			typeof next.tabFocusMode !== "boolean" ||
			!["auto", "on", "off"].includes(next.accessibilitySupport)
		)
			throw new TypeError("readOnly and tabFocusMode must be booleans.");
		if (JSON.stringify(next) === JSON.stringify(this.options)) return;
		const anchor = this.renderer.captureAnchor();
		const refreshAssistance =
			next.inlayHints !== this.options.inlayHints ||
			next.codeLens !== this.options.codeLens;
		this.options = next;
		this.renderer.configure(next);
		this.renderer.setAccessible(next.accessibilitySupport === "on");
		this.element.attachViewport(this.renderer.viewport);
		this.element.setAccessible(next.accessibilitySupport === "on");
		this.renderer.restoreAnchor(anchor);
		this.frame.classList.toggle(
			"editor-bounded-input",
			next.accessibilitySupport !== "on",
		);
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
		if (refreshAssistance) this.languageFeatures.refresh();
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
		this.applyPerSelection((selection) =>
			planIndentationConversion(this.element.value, selection, options),
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
		if (
			[
				"joinLines",
				"sortAscending",
				"sortDescending",
				"uniqueLines",
				"reverseLines",
			].includes(command)
		) {
			this.applyPerLine((selection) =>
				planTextCommand(this.element.value, selection, command),
			);
			return;
		}
		this.applyPerSelection((selection) =>
			planTextCommand(this.element.value, selection, command),
		);
	}
	moveWord(
		direction: -1 | 1,
		action: "move" | "select" | "delete",
		subword = false,
	): void {
		this.applyPerSelection((selection) =>
			planWordCommand(
				this.element.value,
				selection,
				direction,
				action,
				subword,
			),
		);
	}
	jumpToBracket(select = false): void {
		this.applyPerSelection((selection) => {
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
			return {
				edits: [],
				selection: {
					start: Math.min(anchor, target),
					end: Math.max(anchor, target),
					direction: target < anchor ? "backward" : "forward",
				},
			};
		});
	}
	expandSelection(shrink = false): void {
		if (this.multiExpandedKey !== JSON.stringify(this.getSelections()))
			this.multiExpansion.length = 0;
		if (
			this.selectionsValue.length > 1 ||
			(shrink && this.multiExpansion.length > 0)
		) {
			if (shrink) {
				const previous = this.multiExpansion.pop();
				if (previous) this.setSelections(previous, true);
			} else {
				this.multiExpansion.push(
					this.selectionsValue.map((value) => ({ ...value })),
				);
				if (this.multiExpansion.length > 100)
					this.multiExpansion.shift();
				this.applyPerSelection((selection) => {
					const next = expansionRanges(
						this.element.value,
						selection,
						this.getAnalysis(),
					)[0];
					return next ? { edits: [], selection: next } : undefined;
				});
			}
			this.multiExpandedKey = JSON.stringify(this.getSelections());
			return;
		}
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
		return this.renderer.hitTest(x, y);
	}

	private moveSelection(
		selection: TextSelection,
		target: number,
		copy: boolean,
	): void {
		if (
			!this.canEdit() ||
			(target >= selection.start && target <= selection.end)
		)
			return;
		const text = this.element.value.slice(selection.start, selection.end);
		const edits = [{ from: target, to: target, text }];
		if (!copy)
			edits.push({ from: selection.start, to: selection.end, text: "" });
		edits.sort((a, b) => a.from - b.from);
		const offset =
			target +
			text.length -
			(!copy && target > selection.end
				? selection.end - selection.start
				: 0);
		this.applyEditingPlan({ edits, selection: caret(offset) });
	}

	runLineCommand(command: LineCommand): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.composing) return;
		this.breakHistoryGroup();
		if (command === "insertAbove" || command === "insertBelow") {
			this.applyPerSelection((selection) =>
				planLineCommand(
					this.element.value,
					selection,
					command,
					this.options,
				),
			);
			return;
		}
		this.applyPerLine(
			(selection, includeEndLine) =>
				planLineCommand(
					this.element.value,
					selection,
					command,
					this.options,
					includeEndLine,
				),
			command.startsWith("move") || command.startsWith("duplicate")
				? "shift"
				: "collapse",
		);
	}

	toggleLineComment(mode?: "add" | "remove"): void {
		if (this.composing) return;
		this.applyPerLine((selection) =>
			planLineComment(this.element.value, selection, this.language, mode),
		);
	}

	toggleBlockComment(): void {
		if (this.composing) return;
		this.applyPerSelection((selection) =>
			planBlockComment(this.element.value, selection, this.language),
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

	private applyPerLine(
		planner: (
			selection: TextSelection,
			includeEndLine: boolean,
		) => EditingPlan | undefined,
		transform: "map" | "shift" | "collapse" = "map",
	): void {
		if (this.isComposing) return;
		try {
			this.applyMultiPlan(
				combineLinePlans(
					this.element.value,
					this.getSelections(),
					planner,
					transform,
				),
			);
		} catch (error) {
			this.announce(
				error instanceof Error
					? error.message
					: "Cannot combine these line edits.",
			);
		}
	}
	private applyPerSelection(
		planner: (selection: TextSelection) => EditingPlan | undefined,
		inputKind?: string,
	): void {
		const plans = this.getSelections().map(
			(selection) => planner(selection) ?? { edits: [], selection },
		);
		try {
			this.applyMultiPlan(
				combinePlans(plans, this.element.value.length),
				inputKind,
			);
		} catch (error) {
			this.announce(
				error instanceof Error
					? error.message
					: "Cannot combine these edits.",
			);
		}
	}
	private applyMultiPlan(plan: MultiEditingPlan, inputKind?: string): void {
		if (this.isComposing || (plan.edits.length && !this.canEdit())) return;
		if (!plan.edits.length) {
			this.setSelections(plan.selections, true);
			return;
		}
		const previous = this.multiTyping;
		const group = inputKind
			? previous?.kind === inputKind &&
				previous.version === this.model.getVerId() &&
				Date.now() - previous.time <= 750 &&
				previous.selections === JSON.stringify(this.getSelections())
				? previous.id
				: `${this.owner}:${++this.groupSequence}`
			: undefined;
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
		this.writeSelections(plan.selections);
		if (group && inputKind)
			this.multiTyping = {
				id: group,
				kind: inputKind,
				time: Date.now(),
				version: this.model.getVerId(),
				selections: JSON.stringify(this.getSelections()),
			};
		this.updateCursor();
		this.revealCursor();
	}
	private applyEditingPlan(plan: EditingPlan | undefined): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (!plan || this.composing) return;
		if (plan.edits.length && !this.canEdit()) return;
		this.beforeInputState = undefined;
		this.breakHistoryGroup();
		if (plan.edits.length)
			this.applyMultiPlan({ ...plan, selections: [plan.selection] });
		else {
			this.writeSelections([plan.selection]);
			this.updateCursor();
			this.revealCursor();
		}
	}

	private replaceSearch(
		edits: readonly SearchEdit[],
		expectedText: string,
		desiredSelection?: TextSelection,
		group?: string,
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
		this.clearSnippet();
		this.model.undo();
		this.element.focus({ preventScroll: true });
		this.revealCursor();
	}

	redo(): void {
		if (!this.canEdit()) return;
		this.breakHistoryGroup();
		this.beforeInputState = undefined;
		this.clearSnippet();
		this.model.redo();
		this.element.focus({ preventScroll: true });
		this.revealCursor();
	}

	private readonly breakHistoryGroup = (): void => {
		this.typingGroup = undefined;
		this.multiTyping = undefined;
	};

	private captureState(): HistoryViewState {
		const previous = this.selectionsValue[0];
		const selection: TextSelection = {
			start: this.element.selectionStart,
			end: this.element.selectionEnd,
			...(previous?.affinity &&
			previous.start === this.element.selectionStart &&
			previous.end === this.element.selectionEnd
				? { affinity: previous.affinity }
				: {}),
			direction:
				this.element.selectionStart === this.element.selectionEnd
					? "none"
					: this.element.selectionDirection,
		};
		return {
			owner: this.owner,
			selection,
			selections: this.selectionsValue.map((value, index) =>
				index === 0 ? { ...selection } : { ...value },
			),
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
		this.applyPerSelection((selection) =>
			planIndentation(
				this.element.value,
				selection,
				direction,
				this.options,
			),
		);
		this.element.focus({ preventScroll: true });
	}

	private readonly updateCursor = (): void => {
		const selection = this.captureState().selection;
		if (
			!this.sameSelection(
				this.selectionsValue[0] ?? caret(0),
				selection,
			) &&
			!this.pendingSelection &&
			!this.isComposing
		) {
			this.cursorUndo.push(
				this.selectionsValue.map((value) => ({ ...value })),
			);
			if (this.cursorUndo.length > 100) this.cursorUndo.shift();
			this.cursorRedo.length = 0;
		}
		this.selectionsValue[0] = selection;
		this.renderer.setSelections(this.selectionsValue);
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
		const position = this.deferredComposition
			? getInputPosition(this.element.value, offset)
			: this.model.getPositionAtInputOffset(offset);
		this.cursorLabel.textContent = this.attachedModel
			? `Ln ${position.line}, Col ${position.column}${this.selectionsValue.length > 1 ? ` · ${this.selectionsValue.length} cursors` : ""} · ${this.options.insertSpaces ? "Spaces" : "Tabs"}: ${this.options.tabSize}${this.options.readOnly ? " · Read-only" : ""}${this.options.tabFocusMode ? " · Tab moves focus" : ""}`
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
		if (this.element.ownerDocument.activeElement === this.element.native)
			this.updateCursor();
	};

	private readonly handleCompositionStart = (): void => {
		this.cursors.reset();
		if (this.selectionsValue.length > 1) {
			this.writeSelections([this.getSelection()]);
			this.announce("Composition uses the primary cursor.");
		}
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
		this.writeSelections([{ start: from, end: to, direction: "backward" }]);
		this.updateCursor();
		this.revealCursor();
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
				this.applyPerSelection(
					(selection) => {
						const bracket = planBracketInput(
							this.element.value,
							selection,
							event.inputType,
							event.data,
							this.language,
							this.getAnalysis(),
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
		const oldTop = this.element.scrollTop,
			oldLeft = this.element.scrollLeft;
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;
		const position = this.deferredComposition
			? getInputPosition(this.element.value, offset)
			: this.model.getPositionAtInputOffset(offset);
		if (this.assets().folding.reveal(position.line))
			this.renderer.setFolds(this.assets().folding.get());
		const top = this.renderer.point(
			position,
			this.getSelection().affinity,
		).y;
		if (top < this.element.scrollTop + 16)
			this.element.scrollTop = Math.max(0, top - 16);
		else if (
			top + this.options.lineHeight >
			this.element.scrollTop + this.element.clientHeight - 16
		) {
			this.element.scrollTop =
				top + this.options.lineHeight + 16 - this.element.clientHeight;
		}
		const left = this.renderer.point(
			position,
			this.getSelection().affinity,
		).x;
		if (left < this.element.scrollLeft + 16)
			this.element.scrollLeft = Math.max(0, left - 16);
		else if (
			left + 16 >
			this.element.scrollLeft + this.element.clientWidth
		) {
			this.element.scrollLeft = left + 16 - this.element.clientWidth;
		}
		if (
			oldTop !== this.element.scrollTop ||
			oldLeft !== this.element.scrollLeft
		)
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
		if (this.selectionsValue.length > 1) {
			this.selectionsValue = [this.captureState().selection];
			this.announce("This native input uses the primary cursor.");
		}
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
		if (event) {
			this.cursors.reset();
			this.multiExpansion.length = 0;
		}
		if (event?.flush) {
			this.clearSnippet();
			this.selectionsValue = [caret(0)];
			this.cursorUndo.length = 0;
			this.cursorRedo.length = 0;
			this.element.setSelectionRange(0, 0);
			this.element.scrollTop = 0;
			this.element.scrollLeft = 0;
		}
		const scrollAnchor = this.renderer.captureAnchor();
		const oldAnchorOffset =
			getInputLineRange(this.element.value, scrollAnchor.line).from +
			scrollAnchor.column -
			1;
		const previousSelections = this.getSelections();
		if (event && !event.flush) {
			this.cursorUndo.length = 0;
			this.cursorRedo.length = 0;
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
			const anchoredScrollTop = scrollTop;
			this.element.value = text;
			this.element.setSelectionRange(
				start,
				Math.max(start, end),
				this.pendingSelection?.direction ?? selectionDirection,
			);
			this.element.scrollTop = anchoredScrollTop;
			this.element.scrollLeft = scrollLeft;
		}
		if (this.pendingSelections)
			this.writeSelections(this.pendingSelections);
		else if (this.pendingSelection)
			this.writeSelections([this.pendingSelection]);
		else if (event && !event.flush)
			this.writeSelections(
				previousSelections
					.map((selection) => ({
						start: mapModelInputOffset(
							selection.start,
							event,
							"after",
						),
						end: mapModelInputOffset(
							selection.end,
							event,
							selection.start === selection.end
								? "after"
								: "before",
						),
						direction: selection.direction,
						...(selection.affinity
							? { affinity: selection.affinity }
							: {}),
					}))
					.map((selection) => ({
						...selection,
						end: Math.max(selection.start, selection.end),
					})),
			);
		const state = event?.historyState;
		if (state?.owner === this.owner) {
			this.writeSelections(state.selections ?? [state.selection]);
			this.element.scrollTop = state.scrollTop;
			this.element.scrollLeft = state.scrollLeft;
		}
		this.renderer.setFolds(this.assets().folding.get());
		this.refreshDecorations(this.model);
		this.renderer.render();
		if (
			event &&
			!event.flush &&
			!this.pendingSelection &&
			event.historyState?.owner !== this.owner
		) {
			const position = this.model.getPositionAtInputOffset(
				mapModelInputOffset(oldAnchorOffset, event, "after"),
			);
			this.renderer.restoreAnchor({
				...scrollAnchor,
				line: position.line,
				column: position.column,
			});
		}
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
		this.modelListeners.clear();
		this.selectionHistory.length = 0;
		this.multiExpansion.length = 0;
		this.multiExpandedKey = "";
		this.multiTyping = undefined;
		this.renderer.interactionElement.removeEventListener(
			"contextmenu",
			this.handleContextMenu,
		);
		this.cursors.dispose();
		this.selectionsValue = [caret(0)];
		this.cursorUndo.length = 0;
		this.cursorRedo.length = 0;
		this.clearSnippet();
		for (const widget of this.colorWidgets.splice(0)) widget.dispose();
		for (const widget of [...this.contentWidgets]) widget.dispose();
		this.languageFeatures.dispose();
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
		for (const model of [...this.modelAssets.keys()])
			this.releaseAssets(model);
		this.renderer.dispose();
		this.emptyModel.dispose();
		this.attachedModel = null;
		this.model = this.emptyModel;
		this.element.value = "";
		this.element.dispose();
		this.cursorLabel.remove();
		this.frame.remove();
	}
}
