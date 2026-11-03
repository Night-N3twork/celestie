import type { EditorView } from "../view/editor-view";
import type { TextCommand } from "./editing-commands";
import { registerEverydayShortcuts } from "./keyboard-shortcuts";
import type { LineCommand } from "./line-commands";

export function registerEditorActions(view: EditorView): void {
	const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
	const primary = mac ? "Cmd" : "Ctrl";
	const edit = () =>
		!!view.getModel() && !view.getOptions().readOnly && !view.isComposing;
	const available = () => !view.isComposing;
	const add = (
		id: string,
		label: string,
		run: () => void | Promise<void>,
		mutates = false,
		shortcut = "",
		menu = false,
	) =>
		view.commands.register({
			id,
			label,
			run,
			when: mutates ? edit : available,
			shortcut,
			menu,
		});
	add(
		"editor.action.quickCommand",
		"Show All Commands",
		() => view.openCommandPalette(),
		false,
		`F1 / ${primary}+Shift+P`,
		true,
	);
	add("editor.action.contextMenu", "Show Editor Context Menu", () =>
		view.openContextMenu(),
	);
	view.commands.register({
		id: "undo",
		label: "Undo",
		shortcut: `${primary}+Z`,
		menu: true,
		when: () => edit() && view.canUndo,
		run: () => view.undo(),
	});
	view.commands.register({
		id: "redo",
		label: "Redo",
		shortcut: `${primary}+Shift+Z`,
		menu: true,
		when: () => edit() && view.canRedo,
		run: () => view.redo(),
	});
	add(
		"editor.action.clipboardCopyAction",
		"Copy",
		() => view.copy(),
		false,
		`${primary}+C`,
		true,
	);
	add(
		"editor.action.clipboardCopyWithSyntaxHighlightingAction",
		"Copy With Syntax Highlighting",
		() => view.copy(),
	);
	add(
		"editor.action.clipboardCutAction",
		"Cut",
		() => view.copy(true),
		true,
		`${primary}+X`,
		true,
	);
	add(
		"editor.action.clipboardPasteAction",
		"Paste",
		() => view.paste(),
		true,
		`${primary}+V`,
		true,
	);
	add(
		"editor.action.selectAll",
		"Select All",
		() => view.selectAll(),
		false,
		`${primary}+A`,
		true,
	);
	add(
		"actions.find",
		"Find",
		() => view.openFind(),
		false,
		`${primary}+F`,
		true,
	);
	add(
		"editor.action.startFindReplaceAction",
		"Replace",
		() => view.openFind(true),
		true,
		"Ctrl+H",
		true,
	);
	add(
		"editor.action.gotoLine",
		"Go to Line/Column",
		() => view.openGoTo(),
		false,
		"Ctrl+G",
		true,
	);
	add(
		"editor.action.indentLines",
		"Indent Lines",
		() => view.indent(),
		true,
		"Tab",
		true,
	);
	add(
		"editor.action.outdentLines",
		"Outdent Lines",
		() => view.outdent(),
		true,
		"Shift+Tab",
	);
	add(
		"editor.action.commentLine",
		"Toggle Line Comment",
		() => view.toggleLineComment(),
		true,
		`${primary}+/`,
		true,
	);
	add(
		"editor.action.addCommentLine",
		"Add Line Comment",
		() => view.toggleLineComment("add"),
		true,
		`${primary}+K ${primary}+C`,
	);
	add(
		"editor.action.removeCommentLine",
		"Remove Line Comment",
		() => view.toggleLineComment("remove"),
		true,
		`${primary}+K ${primary}+U`,
	);
	add(
		"editor.action.blockComment",
		"Toggle Block Comment",
		() => view.toggleBlockComment(),
		true,
		"Shift+Alt+A",
		true,
	);
	const lines: [LineCommand, string, string, string][] = [
		["moveUp", "editor.action.moveLinesUpAction", "Move Lines Up", "Alt+↑"],
		[
			"moveDown",
			"editor.action.moveLinesDownAction",
			"Move Lines Down",
			"Alt+↓",
		],
		[
			"duplicateUp",
			"editor.action.copyLinesUpAction",
			"Duplicate Lines Up",
			"Shift+Alt+↑",
		],
		[
			"duplicateDown",
			"editor.action.copyLinesDownAction",
			"Duplicate Lines Down",
			"Shift+Alt+↓",
		],
		[
			"delete",
			"editor.action.deleteLines",
			"Delete Lines",
			`${primary}+Shift+K`,
		],
		[
			"insertAbove",
			"editor.action.insertLineBefore",
			"Insert Line Above",
			`${primary}+Shift+Enter`,
		],
		[
			"insertBelow",
			"editor.action.insertLineAfter",
			"Insert Line Below",
			`${primary}+Enter`,
		],
	];
	for (const [command, id, label, shortcut] of lines)
		add(id, label, () => view.runLineCommand(command), true, shortcut);
	const transforms: [TextCommand, string, string][] = [
		["joinLines", "joinLines", "Join Lines"],
		["sortAscending", "sortLinesAscending", "Sort Lines Ascending"],
		["sortDescending", "sortLinesDescending", "Sort Lines Descending"],
		["uniqueLines", "removeDuplicateLines", "Remove Duplicate Lines"],
		["reverseLines", "reverseLines", "Reverse Lines"],
		["upperCase", "transformToUppercase", "Transform to Uppercase"],
		["lowerCase", "transformToLowercase", "Transform to Lowercase"],
		["titleCase", "transformToTitlecase", "Transform to Title Case"],
		["camelCase", "transformToCamelcase", "Transform to Camel Case"],
		["pascalCase", "transformToPascalcase", "Transform to Pascal Case"],
		["snakeCase", "transformToSnakecase", "Transform to Snake Case"],
		["kebabCase", "transformToKebabcase", "Transform to Kebab Case"],
		["transpose", "transpose", "Transpose Characters"],
		[
			"trimTrailingWhitespace",
			"trimTrailingWhitespace",
			"Trim Trailing Whitespace",
		],
		["insertFinalNewline", "insertFinalNewLine", "Insert Final Newline"],
		["trimFinalNewlines", "trimFinalNewlines", "Trim Extra Final Newlines"],
		["deleteAllLeft", "deleteAllLeft", "Delete to Line Start"],
		["deleteAllRight", "deleteAllRight", "Delete to Line End"],
	];
	for (const [command, id, label] of transforms)
		add(
			`editor.action.${id}`,
			label,
			() => view.runTextCommand(command),
			true,
			command === "joinLines"
				? `${primary}+J`
				: command === "trimTrailingWhitespace"
					? `${primary}+K ${primary}+X`
					: "",
		);
	for (const [name, direction] of [
		["Left", -1],
		["Right", 1],
	] as const)
		for (const part of [false, true]) {
			const prefix = part ? "WordPart" : "Word";
			const label = part ? "Subword" : "Word";
			const modifier = part ? "Ctrl+Alt" : mac ? "Option" : "Ctrl";
			add(
				`cursor${prefix}${name}`,
				`Move ${label} ${name}`,
				() => view.moveWord(direction, "move", part),
				false,
				`${modifier}+${name === "Left" ? "←" : "→"}`,
			);
			add(
				`cursor${prefix}${name}Select`,
				`Select ${label} ${name}`,
				() => view.moveWord(direction, "select", part),
				false,
				`${modifier}+Shift+${name === "Left" ? "←" : "→"}`,
			);
			add(
				`delete${prefix}${name}`,
				`Delete ${label} ${name}`,
				() => view.moveWord(direction, "delete", part),
				true,
				`${modifier}+${name === "Left" ? "Backspace" : "Delete"}`,
			);
		}
	add(
		"editor.action.smartSelect.expand",
		"Expand Selection",
		() => view.expandSelection(),
		false,
		"Shift+Alt+→",
	);
	add(
		"editor.action.smartSelect.shrink",
		"Shrink Selection",
		() => view.expandSelection(true),
		false,
		"Shift+Alt+←",
	);
	add(
		"editor.action.jumpToBracket",
		"Go to Matching Bracket",
		() => view.jumpToBracket(),
		false,
		`${primary}+Shift+\\`,
	);
	add("editor.action.selectToBracket", "Select to Matching Bracket", () =>
		view.jumpToBracket(true),
	);
	add(
		"editor.action.indentationToSpaces",
		"Convert Indentation to Spaces",
		() => view.convertIndentation(true),
		true,
	);
	add(
		"editor.action.indentationToTabs",
		"Convert Indentation to Tabs",
		() => view.convertIndentation(false),
		true,
	);
	add("editor.action.indentUsingSpaces", "Indent Using Spaces", () =>
		view.updateOptions({ insertSpaces: true }),
	);
	add("editor.action.indentUsingTabs", "Indent Using Tabs", () =>
		view.updateOptions({ insertSpaces: false }),
	);
	add(
		"editor.action.detectIndentation",
		"Detect Indentation From Content",
		() => view.detectIndentation(),
	);
	for (const tabSize of [1, 2, 3, 4, 5, 6, 7, 8, 12, 16])
		add(
			`editor.action.tabSize.${tabSize}`,
			`Set Tab Size: ${tabSize}`,
			() => view.updateOptions({ tabSize }),
		);
	add(
		"editor.action.toggleReadOnly",
		"Toggle Read-only Mode",
		() => view.updateOptions({ readOnly: !view.getOptions().readOnly }),
		false,
		"",
		true,
	);
	add(
		"editor.action.toggleTabFocusMode",
		"Toggle Tab Key Moves Focus",
		() =>
			view.updateOptions({
				tabFocusMode: !view.getOptions().tabFocusMode,
			}),
		false,
		"Ctrl+M",
	);
	registerEverydayShortcuts(
		view.shortcuts,
		(id) => {
			void view.executeCommand(id);
		},
		mac,
	);
}
