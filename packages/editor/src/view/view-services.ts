import type { EditorOptions } from "../api/editor-options";
import type { Disposable, HistoryViewState, TextSelection } from "../api/types";
import { EditorClipboard } from "../features/clipboard";
import { CommandMenu } from "../features/command-menu";
import type { CommandRegistry } from "../features/commands";
import type { EditingPlan } from "../features/editing-plan";
import { FindReplace, type SearchEdit } from "../features/find-replace";
import { GoToLine } from "../features/go-to-line";
import {
	KeyboardShortcuts,
	registerCommentShortcuts,
	registerLineShortcuts,
} from "../features/keyboard-shortcuts";
import type { LineCommand } from "../features/line-commands";
import { caret, type MultiEditingPlan } from "../features/selections";
import {
	type LanguageConfiguration,
	wordExpression,
} from "../languages/configuration";
import { getInputPosition } from "./input";
import type { InputSurface } from "./input-surface";
import type { TextRenderer } from "./text-renderer";

interface Host {
	options(): EditorOptions;
	attached(): boolean;
	isComposing(): boolean;
	indent(): void;
	outdent(): void;
	undo(): void;
	redo(): void;
	breakHistoryGroup(): void;
	announce(message: string): void;
	trackSelection(selection: TextSelection): {
		getRange(): { from: number; to: number } | undefined;
		dispose(): void;
	};
	captureState(): HistoryViewState;
	writeSelections(values: readonly TextSelection[]): void;
	revealCursor(): void;
	updateCursor(): void;
	replaceSearch(edits: readonly SearchEdit[], expectedText: string): void;
	focus(): void;
	getSelections(): readonly TextSelection[];
	applyMultiPlan(plan: MultiEditingPlan): void;
	applyEditingPlan(plan: EditingPlan | undefined): void;
	offsetAtPoint(x: number, y: number): number;
	toggleLineComment(): void;
	toggleBlockComment(): void;
	runLineCommand(command: LineCommand): void;
	language(): LanguageConfiguration;
}
export class ViewServices implements Disposable {
	readonly shortcuts: KeyboardShortcuts;
	readonly find: FindReplace;
	readonly goTo: GoToLine;
	readonly clipboard: EditorClipboard;
	readonly menu: CommandMenu;
	constructor(
		private readonly host: Host,
		private readonly element: InputSurface,
		private readonly frame: HTMLElement,
		private readonly renderer: TextRenderer,
		readonly commands: CommandRegistry,
	) {
		this.shortcuts = new KeyboardShortcuts(this.element.native, {
			indent: () => this.host.indent(),
			outdent: () => this.host.outdent(),
			undo: () => this.host.undo(),
			redo: () => this.host.redo(),
			isComposing: () => this.host.isComposing(),
			breakHistoryGroup: this.host.breakHistoryGroup,
			announce: (message) => this.host.announce(message),
			isReadOnly: () => this.options.readOnly || !this.attachedModel,
		});
		this.shortcuts.setTabFocusMode(
			this.options.tabFocusMode || this.options.readOnly,
		);
		this.renderer.setTabSize(this.options.tabSize);
		registerCommentShortcuts(this.shortcuts, {
			line: () => this.host.toggleLineComment(),
			block: () => this.host.toggleBlockComment(),
		});
		registerLineShortcuts(this.shortcuts, (command) =>
			this.host.runLineCommand(command),
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
					!this.host.isComposing(),
				trackSelection: (selection) =>
					this.host.trackSelection(selection),
				getText: () => this.element.value,
				wordPattern: () => wordExpression(this.host.language()),
				getSelection: () => this.host.captureState().selection,
				selectMatch: (match) => {
					this.host.breakHistoryGroup();
					this.host.writeSelections([
						{
							start: match.from,
							end: match.to,
							direction: "forward",
						},
					]);
					this.host.revealCursor();
					this.host.updateCursor();
				},
				replace: (edits, expectedText) =>
					this.host.replaceSearch(edits, expectedText),
				highlight: (matches, current) =>
					this.renderer.setSearchMatches(matches, current),
				focusEditor: () => this.host.focus(),
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
					this.host.breakHistoryGroup();
					this.host.writeSelections([caret(offset)]);
					this.host.revealCursor();
					this.host.updateCursor();
				},
				focusEditor: () => this.host.focus(),
			},
			this.shortcuts,
		);
		this.clipboard = new EditorClipboard(
			this.element.native,
			{
				consumeChord: (key) =>
					this.shortcuts.consumeClipboardChord(key),
				getText: () => this.element.value,
				getSelection: () => this.host.captureState().selection,
				isReadOnly: () => this.options.readOnly || !this.attachedModel,
				isComposing: () => this.host.isComposing(),
				getSelections: () => this.host.getSelections(),
				apply: (plan) =>
					plan.selections
						? this.host.applyMultiPlan({
								...plan,
								selections: plan.selections,
							})
						: this.host.applyEditingPlan(plan),
				focus: () => this.host.focus(),
				announce: (message) => this.host.announce(message),
				offsetAtPoint: (x, y) => this.host.offsetAtPoint(x, y),
				getTabSize: () => this.options.tabSize,
				pasteIndentation: () =>
					this.options.autoIndentOnPaste ? this.options : undefined,
				syntaxPalette: () => this.renderer.syntaxPalette(),
			},
			this.renderer.interactionElement,
		);
		this.menu = new CommandMenu(this.frame, this.commands, this.shortcuts, {
			focus: () => this.host.focus(),
			onOpen: () => {
				this.find.close(false);
				this.goTo.close(false);
				this.host.breakHistoryGroup();
			},
			announce: (message) => this.host.announce(message),
		});
	}
	private get options() {
		return this.host.options();
	}
	private get attachedModel() {
		return this.host.attached();
	}
	dispose(): void {
		this.clipboard.dispose();
		this.menu.dispose();
		this.find.dispose();
		this.goTo.dispose();
		this.shortcuts.dispose();
	}
}
