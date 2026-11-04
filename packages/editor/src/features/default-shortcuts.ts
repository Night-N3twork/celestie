import type { Disposable } from "../api/types";
import type { KeyboardShortcut, KeyboardShortcuts } from "./keyboard-shortcuts";
import type { LineCommand } from "./line-commands";
export function registerLineShortcuts(
	shortcuts: KeyboardShortcuts,
	run: (command: LineCommand) => void,
): Disposable {
	const bindings: KeyboardShortcut[] = [
		{
			id: "editor.moveLinesUp",
			key: "ArrowUp",
			alt: true,
			run: () => run("moveUp"),
		},
		{
			id: "editor.moveLinesDown",
			key: "ArrowDown",
			alt: true,
			run: () => run("moveDown"),
		},
		{
			id: "editor.duplicateLinesUp",
			key: "ArrowUp",
			alt: true,
			shift: true,
			run: () => run("duplicateUp"),
		},
		{
			id: "editor.duplicateLinesDown",
			key: "ArrowDown",
			alt: true,
			shift: true,
			run: () => run("duplicateDown"),
		},
		{
			id: "editor.deleteLines",
			key: "k",
			primary: true,
			shift: true,
			run: () => run("delete"),
		},
		{
			id: "editor.insertLineAbove",
			key: "Enter",
			primary: true,
			shift: true,
			run: () => run("insertAbove"),
		},
		{
			id: "editor.insertLineBelow",
			key: "Enter",
			primary: true,
			run: () => run("insertBelow"),
		},
	];
	const subscriptions = bindings.map((binding) =>
		shortcuts.register(binding),
	);
	return {
		dispose: () => {
			for (const subscription of subscriptions) subscription.dispose();
		},
	};
}

export function registerEverydayShortcuts(
	shortcuts: KeyboardShortcuts,
	execute: (id: string) => void,
	mac: boolean,
): Disposable {
	const bindings: KeyboardShortcut[] = [];
	const bind = (
		id: string,
		key: string,
		modifiers: Partial<
			Pick<
				KeyboardShortcut,
				"primary" | "ctrl" | "meta" | "alt" | "shift" | "chord"
			>
		> = {},
	) =>
		bindings.push({
			id: `action.${id}.${bindings.length}`,
			key,
			...modifiers,
			run: () => execute(id),
		});
	bind("language.complete", " ", { ctrl: true });
	bind("language.hover", "k", {
		primary: true,
		chord: [{ key: "i", primary: true }],
	});
	bind("language.formatSelection", "k", {
		primary: true,
		chord: [{ key: "f", primary: true }],
	});
	bind("language.signature", " ", { primary: true, shift: true });
	bind("language.definitions", "F12");
	bind("language.references", "F12", { shift: true });
	bind("language.rename", "F2");
	bind("language.symbols", "o", { primary: true, shift: true });
	bind("language.problems", "m", { primary: true, shift: true });
	bind("language.format", "f", { shift: true, alt: true });
	bind("language.actions", ".", { primary: true });
	bind("language.inline", "\\", { alt: true });
	bind("view.toggleFold", "[", { primary: true, shift: true });
	bind("view.unfoldAll", "]", { primary: true, shift: true });
	bind("view.toggleWrap", "z", { alt: true });
	bind("view.toggleFold", "{", { primary: true, shift: true });
	bind("view.unfoldAll", "}", { primary: true, shift: true });
	bind("editor.action.quickCommand", "F1");
	bind("editor.action.quickCommand", "p", {
		primary: true,
		shift: true,
	});
	bind("editor.action.selectAll", "a", { primary: true });

	bind("editor.action.insertCursorAbove", "ArrowUp", {
		ctrl: true,
		alt: true,
	});
	bind("editor.action.insertCursorBelow", "ArrowDown", {
		ctrl: true,
		alt: true,
	});
	bind("editor.action.addSelectionToNextFindMatch", "d", { primary: true });
	bind("editor.action.selectHighlights", "l", { primary: true, shift: true });
	bind("cursorUndo", "u", { primary: true });
	bind("cursorRedo", "u", { primary: true, shift: true });
	bind("editor.action.smartSelect.expand", "ArrowRight", {
		alt: true,
		shift: true,
	});
	bind("editor.action.smartSelect.shrink", "ArrowLeft", {
		alt: true,
		shift: true,
	});
	bind("editor.action.jumpToBracket", "\\", { primary: true, shift: true });
	bindings.push({
		id: "action.jumpToBracketPipe",
		key: "|",
		primary: true,
		shift: true,
		run: () => execute("editor.action.jumpToBracket"),
	});
	bind("editor.action.contextMenu", "ContextMenu");
	bind("editor.action.contextMenu", "F10", { shift: true });
	bind("editor.action.toggleTabFocusMode", "m", { ctrl: true });
	bind("editor.action.joinLines", "j", { primary: true });
	if (mac) bind("editor.action.transpose", "t", { ctrl: true });
	for (const direction of ["Left", "Right"] as const) {
		const base = mac ? { alt: true } : { ctrl: true };
		bind(`cursorWord${direction}`, `Arrow${direction}`, base);
		bind(`cursorWord${direction}Select`, `Arrow${direction}`, {
			...base,
			shift: true,
		});
		bind(
			`deleteWord${direction}`,
			direction === "Left" ? "Backspace" : "Delete",
			base,
		);
		bind(`cursorWordPart${direction}`, `Arrow${direction}`, {
			ctrl: true,
			alt: true,
		});
		bind(
			`deleteWordPart${direction}`,
			direction === "Left" ? "Backspace" : "Delete",
			{ ctrl: true, alt: true },
		);
	}
	for (const [id, key] of [
		["editor.action.addCommentLine", "c"],
		["editor.action.removeCommentLine", "u"],
		["editor.action.trimTrailingWhitespace", "x"],
	])
		bind(id ?? "", "k", {
			primary: true,
			chord: [{ key: key ?? "", primary: true }],
		});
	for (const direction of ["Up", "Down", "Left", "Right"])
		bind(`cursorColumnSelect${direction}`, `Arrow${direction}`, {
			ctrl: true,
			shift: true,
			alt: true,
		});
	const subscriptions = bindings.map((binding) =>
		shortcuts.register(binding),
	);
	return {
		dispose: () => {
			for (const subscription of subscriptions) subscription.dispose();
		},
	};
}

export function registerCommentShortcuts(
	shortcuts: KeyboardShortcuts,
	commands: { line: () => void; block: () => void },
): Disposable {
	const subscriptions = [
		shortcuts.register({
			id: "editor.toggleLineComment",
			key: "/",
			primary: true,
			run: commands.line,
		}),
		shortcuts.register({
			id: "editor.toggleBlockComment",
			key: "?",
			primary: true,
			shift: true,
			run: commands.block,
		}),
		shortcuts.register({
			id: "editor.toggleBlockCommentSlash",
			key: "/",
			primary: true,
			shift: true,
			run: commands.block,
		}),
		shortcuts.register({
			id: "editor.toggleBlockCommentAlt",
			key: "a",
			shift: true,
			alt: true,
			run: commands.block,
		}),
	];
	return {
		dispose: () => {
			for (const subscription of subscriptions) subscription.dispose();
		},
	};
}
