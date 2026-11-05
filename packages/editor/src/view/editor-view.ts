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
	WorkspaceEdit,
} from "../api/languages";
import type {
	Disposable,
	HistoryViewState,
	ModelChangeEvent,
} from "../api/types";
import { BracketAnalysis } from "../features/bracket-analysis";
import type { TransferProvider } from "../features/clipboard";
import { CommandRegistry } from "../features/commands";
import type { DecorationCollection } from "../features/decorations";
import { type TextCommand, wordRange } from "../features/editing-commands";
import type { EditingPlan } from "../features/editing-plan";
import { registerEditorActions } from "../features/editor-actions";
import type { SearchEdit } from "../features/find-replace";
import type { FoldingRange } from "../features/folding";
import { planIndentation, type TextSelection } from "../features/indentation";
import {
	detectIndentation,
	type IndentationOptions,
	planIndentationConversion,
	resolveIndentation,
} from "../features/indentation-options";
import { LanguageEdits } from "../features/language-edits";
import { LanguageFeatures } from "../features/language-features";
import type { LineCommand } from "../features/line-commands";
import {
	caret,
	combinePlans,
	type MultiEditingPlan,
	normalizeSelections,
	replacementPlan,
	selectionLimit,
} from "../features/selections";
import { SnippetSession } from "../features/snippet-session";
import { ViewEditing } from "../features/view-editing";
import { languageEngine } from "../languages/client";
import {
	getLanguageConfiguration,
	type LanguageConfiguration,
	resolveLanguageConfiguration,
} from "../languages/configuration";
import { mapModelInputOffset } from "../model/change-mapping";
import { TextModel } from "../model/text-model";
import {
	findTextChange,
	getInputLineRange,
	getInputPosition,
	normalizeInputText,
} from "./input";
import { InputSurface } from "./input-surface";
import { NativeInputController } from "./native-input-controller";
import { SavedViewStates } from "./saved-view-states";
import { createSelectionController } from "./selection-bindings";
import type { SelectionController } from "./selection-controller";
import { TextRenderer } from "./text-renderer";
import { ViewPresentation } from "./view-presentation";
import { ViewServices } from "./view-services";
import { ViewTransactions } from "./view-transactions";

export class EditorView implements Disposable {
	get shortcuts() {
		return this.services.shortcuts;
	}
	readonly commands = new CommandRegistry();
	private readonly services: ViewServices;
	private get menu() {
		return this.services.menu;
	}
	private get clipboard() {
		return this.services.clipboard;
	}
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
	private readonly cursors: SelectionController;
	private readonly cursorUndo: TextSelection[][] = [];
	private readonly cursorRedo: TextSelection[][] = [];
	private readonly editing = new ViewEditing({
		text: () => this.element.value,
		options: () => this.options,
		language: () => this.language,
		disposed: () => this.disposed,
		composing: () => this.nativeInput.composing,
		isComposing: () => this.isComposing,
		getSelection: () => this.getSelection(),
		getSelections: () => this.getSelections(),
		setSelections: (v, r) => this.setSelections(v, r),
		getAnalysis: () => this.getAnalysis(),
		sameSelection: (a, b) => this.sameSelection(a, b),
		breakHistoryGroup: () => this.breakHistoryGroup(),
		applyEditingPlan: (p) => this.applyEditingPlan(p),
		applyMultiPlan: (p, k) => this.applyMultiPlan(p, k),
		announce: (m) => this.announce(m),
	});
	private readonly element: InputSurface;
	private readonly nativeInput: NativeInputController;
	private readonly modelSubscriptions: Disposable[] = [];
	private readonly savedViews = new SavedViewStates();
	private model: TextModel;
	private attachedModel: TextModel | null = null;
	private readonly emptyModel = new TextModel("", { register: false });
	private readonly renderer: TextRenderer;
	private readonly presentation: ViewPresentation;
	private readonly cursorLabel: HTMLDivElement;
	private readonly frame: HTMLDivElement;
	private get find() {
		return this.services.find;
	}
	private get goTo() {
		return this.services.goTo;
	}
	private disposed = false;
	private readonly owner = crypto.randomUUID();
	private readonly transactions = new ViewTransactions(
		{
			input: () => this.element,
			model: () => this.model,
			disposed: () => this.disposed,
			composing: () => this.nativeInput.composing,
			isComposing: () => this.isComposing,
			canEdit: () => this.canEdit(),
			captureState: () => this.captureState(),
			breakHistoryGroup: () => this.breakHistoryGroup(),
			clearBeforeInput: () => {
				this.nativeInput.beforeInputState = undefined;
			},
			clearSnippet: () => this.clearSnippet(),
			getSelections: () => this.getSelections(),
			setSelections: (v, r) => this.setSelections(v, r),
			writeSelections: (v) => this.writeSelections(v),
			updateCursor: () => this.updateCursor(),
			revealCursor: () => this.revealCursor(),
		},
		this.owner,
	);
	private get pendingSelection() {
		return this.transactions.pendingSelection;
	}
	private set pendingSelection(v: TextSelection | undefined) {
		this.transactions.pendingSelection = v;
	}
	private get pendingSelections() {
		return this.transactions.pendingSelections;
	}
	private readonly languageFeatures: LanguageFeatures;
	private readonly snippets = new SnippetSession({
		model: () => this.model,
		text: () => this.element.value,
		options: () => this.options,
		attached: () => !!this.attachedModel,
		isComposing: () => this.isComposing,
		canEdit: () => this.canEdit(),
		getSelection: () => this.getSelection(),
		getSelections: () => this.getSelections(),
		setSelections: (v, r) => this.setSelections(v, r),
		applyMultiPlan: (p, g) =>
			this.transactions.applyMultiPlan(p, undefined, g),
		applyCompletionPlan: (p, e) => this.languageEdits.applyCompletion(p, e),
		mergeCompletionEdits: (p, e) => this.mergeCompletionEdits(p, e),
		offerChoices: (v) => this.languageFeatures.offerSnippetChoices(v),
	});
	private readonly languageEdits = new LanguageEdits({
		model: () => this.model,
		text: () => this.element.value,
		canEdit: () => this.canEdit(),
		getSelections: () => this.getSelections(),
		applyMultiPlan: (p) => this.applyMultiPlan(p),
		applyWorkspace: (b, s) => this.transactions.applyWorkspace(b, s),
		workspaceHandler: () => this.workspaceHandler,
	});
	private readonly locationHandler: EditorViewOptions["onOpenLocation"];
	private readonly workspaceHandler: EditorViewOptions["onWorkspaceEdit"];
	private lastSelection: TextSelection = {
		start: 0,
		end: 0,
		direction: "none",
	};
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
		this.workspaceHandler = options.onWorkspaceEdit;
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
		const view = this;
		this.nativeInput = new NativeInputController({
			input: () => this.element,
			frame: () => this.frame,
			model: () => this.model,
			options: () => this.options,
			language: () => this.language,
			attached: () => this.attachedModel,
			disposed: () => this.disposed,
			lastSelection: () => this.lastSelection,
			get selectionsValue() {
				return view.selectionsValue;
			},
			set selectionsValue(v) {
				view.selectionsValue = v;
			},
			get pendingSelection() {
				return view.pendingSelection;
			},
			set pendingSelection(v) {
				view.pendingSelection = v;
			},
			resetMultiTyping: () => {
				this.transactions.resetTyping();
			},
			nextGroup: () => this.transactions.nextGroup(),
			resetCursors: () => this.cursors.reset(),
			announce: (m) => this.announce(m),
			applyEditingPlan: (p) => this.applyEditingPlan(p),
			applyPerSelection: (p, k) => this.applyPerSelection(p, k),
			captureState: () => this.captureState(),
			getAnalysis: () => this.getAnalysis(),
			getSelection: () => this.getSelection(),
			hasSnippet: () => this.snippets.active,
			redo: () => this.redo(),
			render: () => this.render(),
			revealCursor: () => this.revealCursor(),
			sameSelection: (a, b) => this.sameSelection(a, b),
			undo: () => this.undo(),
			updateCursor: () => this.updateCursor(),
			updateOptions: (o) => this.updateOptions(o),
			writeSelections: (v) => this.writeSelections(v),
		});
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
		this.presentation = new ViewPresentation(
			{
				document,
				model: () => this.model,
				hasModel: () => !!this.attachedModel,
				disposed: () => this.disposed,
				getSelection: () => this.getSelection(),
				setSelections: (v, r) => this.setSelections(v, r),
				updateCursor: () => this.updateCursor(),
				executeCommand: (id) => this.executeCommand(id),
				runLanguageCommand: (id) => this.runLanguageCommand(id),
				diagnosticsChanged: (values) =>
					this.languageFeatures?.updateStatus(values),
			},
			this.renderer,
		);
		this.renderer.configure(this.options);
		this.element.attachViewport(this.renderer.viewport, {
			get: () => this.renderer.scrollTop,
			getLeft: () => this.renderer.scrollLeft,
			setLeft: (value) => {
				this.renderer.scrollLeft = value;
			},
			set: (value) => {
				this.renderer.scrollTop = value;
			},
		});
		this.renderer.setAccessible(this.options.accessibilitySupport === "on");
		this.element.attachViewport(this.renderer.viewport, {
			get: () => this.renderer.scrollTop,
			getLeft: () => this.renderer.scrollLeft,
			setLeft: (value) => {
				this.renderer.scrollLeft = value;
			},
			set: (value) => {
				this.renderer.scrollTop = value;
			},
		});
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
		this.services = new ViewServices(
			{
				options: () => this.options,
				attached: () => !!this.attachedModel,
				isComposing: () => this.isComposing,
				indent: () => this.indent(),
				outdent: () => this.outdent(),
				undo: () => this.undo(),
				redo: () => this.redo(),
				breakHistoryGroup: this.breakHistoryGroup,
				announce: (m) => this.announce(m),
				trackSelection: (s) => this.trackSelection(s),
				captureState: () => this.captureState(),
				writeSelections: (v) => this.writeSelections(v),
				revealCursor: () => this.revealCursor(),
				updateCursor: () => this.updateCursor(),
				replaceSearch: (e, t) => this.replaceSearch(e, t),
				focus: () => this.focus(),
				getSelections: () => this.getSelections(),
				applyMultiPlan: (p) => this.applyMultiPlan(p),
				applyEditingPlan: (p) => this.applyEditingPlan(p),
				offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
				toggleLineComment: () => this.toggleLineComment(),
				toggleBlockComment: () => this.toggleBlockComment(),
				runLineCommand: (c) => this.runLineCommand(c),
			},
			this.element,
			this.frame,
			this.renderer,
			this.commands,
			this.language,
		);
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
		this.cursors = createSelectionController(
			this.element,
			this.frame,
			this.renderer,
			{
				model: () => this.model,
				options: () => this.options,
				getSelections: () => this.getSelections(),
				setSelections: (v, r) => this.setSelections(v, r),
				offsetAtPoint: (x, y) => this.offsetAtPoint(x, y),
				toggleFold: (l) => this.toggleFold(l),
				moveSelection: (s, t, c) => this.moveSelection(s, t, c),
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
			accept: (item, character) => this.acceptCompletion(item, character),
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
		return this.presentation.addContentWidget(
			id,
			node,
			position,
			placement,
		);
	}

	private setLanguageAnalysis(value: Analysis): void {
		this.presentation.setLanguageAnalysis(value);
	}

	runLanguageCommand(command: string): void {
		void this.languageFeatures.run(command);
	}
	private applyLanguageEdits(
		edits: readonly LanguageEdit[] | WorkspaceEdit,
	): void | Promise<void> {
		return this.languageEdits.applyResult(edits);
	}

	private mergeCompletionEdits(
		plan: MultiEditingPlan,
		extras: readonly LanguageEdit[],
	): MultiEditingPlan {
		return this.languageEdits.mergeCompletion(plan, extras);
	}
	private acceptCompletion(item: Completion, commitCharacter?: string): void {
		if (!this.canEdit()) return;
		if (
			commitCharacter &&
			!item.snippet &&
			!item.insertText.endsWith(commitCharacter)
		)
			item = { ...item, insertText: item.insertText + commitCharacter };
		const primary = this.getSelection(),
			values = this.getSelections().map((selection) => ({
				...selection,
				start: Math.max(0, selection.start + item.from - primary.start),
				end: Math.max(0, selection.end + item.to - primary.end),
			}));
		if (item.snippet)
			this.snippets.insert(
				item.insertText,
				{},
				values,
				item.additionalEdits,
				commitCharacter,
			);
		else
			this.languageEdits.applyCompletion(
				this.mergeCompletionEdits(
					combinePlans(
						values.map((selection) =>
							replacementPlan(selection, item.insertText),
						),
						this.element.value.length,
					),
					item.additionalEdits ?? [],
				),
				item.additionalEdits ?? [],
			);
	}

	insertSnippet(
		body: string,
		variables: Readonly<Record<string, string>> = {},
		targets?: readonly TextSelection[],
		extras: readonly LanguageEdit[] = [],
	): void {
		this.snippets.insert(body, variables, targets, extras);
	}
	private nextSnippet(backward: boolean): boolean {
		return this.snippets.next(backward);
	}
	private clearSnippet(): void {
		this.snippets.clear();
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
	private refreshDecorations(model: TextModel): void {
		this.presentation.refreshDecorations(model);
	}
	createDecorations(): DecorationCollection {
		return this.presentation.createDecorations();
	}

	setDiagnostics(
		diagnostics: readonly Diagnostic[],
		owner = "language",
	): void {
		this.presentation.setDiagnostics(diagnostics, owner);
	}
	getDiagnostics(owner?: string): readonly Diagnostic[] {
		return this.presentation.getDiagnostics(owner);
	}

	setSyntaxTokens(tokens: readonly Token[]): void {
		this.presentation.setSyntaxTokens(tokens);
	}
	setFoldingRanges(ranges: readonly FoldingRange[]): void {
		this.presentation.setFoldingRanges(ranges);
	}
	toggleFold(line?: number): void {
		this.presentation.toggleFold(line);
	}
	foldAll(collapsed: boolean): void {
		this.presentation.foldAll(collapsed);
	}
	getModel(): TextModel | null {
		return this.attachedModel;
	}
	setModel(model: TextModel | null): void {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (this.nativeInput.composing || this.nativeInput.deferredComposition)
			throw new Error("Finish composition before switching documents.");
		this.switchModel(model, true);
	}
	private bindModel(model: TextModel): void {
		this.modelSubscriptions.push(
			model.onDidChangeContent((event) => {
				this.editing.resetSingle();

				if (!this.pendingSelection) this.breakHistoryGroup();
				if (
					(this.nativeInput.composing ||
						this.nativeInput.deferredComposition) &&
					!this.pendingSelection
				) {
					this.nativeInput.deferredComposition ??= {
						model,
						base: this.element.value,
						before: this.captureState(),
						batches: [],
						flush: false,
					};
					this.nativeInput.deferredComposition.batches.push(
						event.inputChanges ?? [],
					);
					this.nativeInput.deferredComposition.flush ||= event.flush;
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
				this.nativeInput.composing = false;
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
		this.languageEdits.cancel();
		if (model === this.attachedModel) return;
		this.cursors.reset();
		this.editing.resetMulti();
		if (model?.isDisposed())
			throw new Error("Cannot attach a disposed model.");
		if (save && this.attachedModel) this.rememberModel(this.attachedModel);
		for (const subscription of this.modelSubscriptions.splice(0))
			subscription.dispose();
		this.find.close(false);
		this.goTo.close(false);
		this.menu.close(false);
		this.breakHistoryGroup();
		this.nativeInput.beforeInputState = undefined;
		this.pendingSelection = undefined;
		this.nativeInput.compositionGroup = undefined;
		this.nativeInput.compositionEndText = "";
		this.nativeInput.deferredComposition = undefined;
		this.frame.classList.remove("editor-composition-pending");
		this.editing.resetSingle();

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
		this.presentation.clearColors();
		this.languageFeatures.setModel(model);
		this.renderer.setModel(this.model);
		this.renderer.setFolds(this.presentation.assets().folding.get());
		this.refreshDecorations(this.model);
		if (model) {
			this.bindModel(model);
			const options = model.getOptions();
			this.updateOptions({
				tabSize: options.tabSize,
				insertSpaces: options.insertSpaces,
			});
			this.savedViews.restore(model, this.renderer, this.element, (v) =>
				this.writeSelections(v),
			);
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
		this.savedViews.remember(model, this.captureState(), this.renderer);
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
			this.nativeInput.composing ||
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
		return (
			this.nativeInput.composing || !!this.nativeInput.deferredComposition
		);
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
		if (
			this.nativeInput.composing ||
			this.nativeInput.deferredComposition
		) {
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
		this.element.attachViewport(this.renderer.viewport, {
			get: () => this.renderer.scrollTop,
			getLeft: () => this.renderer.scrollLeft,
			setLeft: (value) => {
				this.renderer.scrollLeft = value;
			},
			set: (value) => {
				this.renderer.scrollTop = value;
			},
		});
		this.element.setAccessible(next.accessibilitySupport === "on");
		this.renderer.restoreAnchor(anchor);
		this.frame.classList.toggle(
			"editor-bounded-input",
			next.accessibilitySupport !== "on",
		);
		this.breakHistoryGroup();
		this.element.readOnly = next.readOnly || !this.attachedModel;
		if (next.readOnly) this.clearSnippet();
		if (next.readOnly) this.languageFeatures.cancelRequests();
		if (next.readOnly) this.languageEdits.cancel();
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
		this.editing.runTextCommand(command);
	}
	moveWord(
		direction: -1 | 1,
		action: "move" | "select" | "delete",
		subword = false,
	): void {
		this.editing.moveWord(direction, action, subword);
	}
	jumpToBracket(select = false): void {
		this.editing.jumpToBracket(select);
	}
	expandSelection(shrink = false): void {
		this.editing.expandSelection(shrink);
	}

	private canEdit(): boolean {
		if (this.disposed) throw new Error("Editor view disposed.");
		if (!this.attachedModel) {
			this.announce("No document is attached.");
			return false;
		}
		if (
			this.options.readOnly ||
			this.nativeInput.composing ||
			this.nativeInput.deferredComposition
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
		if (event.shiftKey || this.nativeInput.composing) return;
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
		this.editing.runLineCommand(command);
	}

	toggleLineComment(mode?: "add" | "remove"): void {
		this.editing.toggleLineComment(mode);
	}

	toggleBlockComment(): void {
		this.editing.toggleBlockComment();
	}

	private getAnalysis(): BracketAnalysis {
		if (this.analysis?.text !== this.element.value)
			this.analysis = new BracketAnalysis(
				this.element.value,
				this.language,
			);
		return this.analysis;
	}
	private applyPerSelection(
		planner: (selection: TextSelection) => EditingPlan | undefined,
		inputKind?: string,
	): void {
		this.editing.applyPerSelection(planner, inputKind);
	}
	private applyMultiPlan(plan: MultiEditingPlan, inputKind?: string): void {
		const group = this.snippets.beforeEdit(plan);
		let applied = false;
		try {
			this.transactions.applyMultiPlan(plan, inputKind, group);
			applied = true;
		} finally {
			if (group) this.snippets.afterEdit(applied);
		}
	}
	private applyEditingPlan(plan: EditingPlan | undefined): void {
		this.transactions.applyEditingPlan(plan);
	}

	private replaceSearch(
		edits: readonly SearchEdit[],
		expectedText: string,
		desiredSelection?: TextSelection,
		group?: string,
	): void {
		this.transactions.replaceSearch(
			edits,
			expectedText,
			desiredSelection,
			group,
		);
	}

	indent(): void {
		this.changeIndentation("indent");
	}

	outdent(): void {
		this.changeIndentation("outdent");
	}

	undo(): void {
		this.transactions.undo();
	}

	redo(): void {
		this.transactions.redo();
	}
	private readonly breakHistoryGroup = (): void => {
		this.nativeInput.resetHistoryGroup();
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
		this.snippets.selectionChanged();
		this.renderer.setSelections(this.selectionsValue);
		if (
			this.nativeInput.typingGroup &&
			!this.sameSelection(
				this.nativeInput.typingGroup.selection,
				selection,
			)
		)
			this.breakHistoryGroup();
		this.lastSelection = selection;
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;
		const position = this.nativeInput.deferredComposition
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
		this.clearSnippet();
		this.languageFeatures.cancelRequests();
		this.nativeInput.handleCompositionStart();
	};
	private readonly handleCompositionEnd = (event: CompositionEvent): void => {
		this.nativeInput.handleCompositionEnd(event);
	};

	private readonly selectLine = (line: number): void => {
		const { from, to } = getInputLineRange(this.element.value, line);
		this.element.focus({ preventScroll: true });
		this.writeSelections([{ start: from, end: to, direction: "backward" }]);
		this.updateCursor();
		this.revealCursor();
	};
	private readonly handleBeforeInput = (event: InputEvent): void => {
		this.nativeInput.handleBeforeInput(event);
	};

	private revealCursor(): void {
		const oldTop = this.element.scrollTop,
			oldLeft = this.element.scrollLeft;
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;
		const position = this.nativeInput.deferredComposition
			? getInputPosition(this.element.value, offset)
			: this.model.getPositionAtInputOffset(offset);
		if (this.presentation.assets().folding.reveal(position.line))
			this.renderer.setFolds(this.presentation.assets().folding.get());
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
		this.nativeInput.handleInput(event);
	};

	private render(event?: ModelChangeEvent): void {
		if (event) {
			this.cursors.reset();
			this.editing.resetMulti();
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
		this.renderer.setFolds(this.presentation.assets().folding.get());
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
		this.languageEdits.cancel();
		if (this.disposed) return;
		this.disposed = true;
		this.nativeInput.deferredComposition = undefined;
		this.analysis = undefined;
		if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
		this.optionListeners.clear();
		this.modelListeners.clear();
		this.editing.resetSingle();
		this.editing.resetMulti();

		this.transactions.resetTyping();
		this.renderer.interactionElement.removeEventListener(
			"contextmenu",
			this.handleContextMenu,
		);
		this.cursors.dispose();
		this.selectionsValue = [caret(0)];
		this.cursorUndo.length = 0;
		this.cursorRedo.length = 0;
		this.clearSnippet();
		this.presentation.clearColors();

		this.languageFeatures.dispose();
		this.services.dispose();

		this.commands.dispose();
		this.element.removeEventListener("input", this.handleInput);

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
		this.savedViews.dispose();
		this.presentation.dispose();
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
