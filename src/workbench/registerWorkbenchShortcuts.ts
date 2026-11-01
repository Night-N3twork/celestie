import { onCleanup } from "solid-js";
import type { WorkbenchController } from "./createWorkbenchController";

type Services = Pick<
	WorkbenchController,
	"run" | "setWorkspaceSearchOpen" | "setWorkspaceSearchFocus"
>;
export function registerWorkbenchShortcuts(services: Services): void {
	const { run, setWorkspaceSearchOpen, setWorkspaceSearchFocus } = services;
	const keydown = (event: KeyboardEvent) => {
		if (event.isComposing) return;
		const textField = event.target instanceof HTMLInputElement;
		const mac = /Mac|iPhone|iPad/.test(navigator.platform);
		if (
			event.altKey &&
			!mac &&
			!textField &&
			!event.shiftKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight")
		) {
			event.preventDefault();
			void run(
				event.key === "ArrowLeft"
					? "navigation.back"
					: "navigation.forward",
			);
			return;
		}
		if (
			!event.isComposing &&
			event.altKey &&
			(event.key === "ArrowUp" || event.key === "ArrowDown") &&
			!textField
		) {
			event.preventDefault();
			void run(
				event.shiftKey
					? "editor.duplicate"
					: event.key === "ArrowUp"
						? "editor.up"
						: "editor.down",
			);
			return;
		}
		if (
			!event.isComposing &&
			event.shiftKey &&
			event.altKey &&
			event.key.toLowerCase() === "f"
		) {
			event.preventDefault();
			void run("editor.format");
			return;
		}
		if (!event.isComposing && event.key === "F3") {
			event.preventDefault();
			void run(event.shiftKey ? "search.previous" : "search.next");
			return;
		}
		if (
			event.isComposing ||
			!(event.ctrlKey || event.metaKey) ||
			event.altKey
		)
			return;
		const key = event.key.toLowerCase();
		if (
			textField &&
			(key === "d" ||
				key === "l" ||
				key === "/" ||
				event.code === "Backslash")
		)
			return;
		const multi =
			key === "d"
				? "editor.nextOccurrence"
				: key === "l" && event.shiftKey
					? "editor.allOccurrences"
					: undefined;
		if (multi) {
			event.preventDefault();
			void run(multi);
			return;
		}
		const navigation =
			key === "p"
				? event.shiftKey
					? "navigation.commands"
					: "navigation.files"
				: key === "g"
					? "navigation.line"
					: key === "/"
						? "editor.comment"
						: event.code === "Backslash" && event.shiftKey
							? "editor.bracket"
							: undefined;
		if (navigation) {
			event.preventDefault();
			void run(navigation);
			return;
		}
		if (event.shiftKey && (key === "f" || key === "h")) {
			event.preventDefault();
			setWorkspaceSearchOpen(true);
			setWorkspaceSearchFocus((value) => value + 1);
			return;
		}
		if (key === "f" || key === "h") {
			event.preventDefault();
			void run(key === "h" ? "search.replace" : "search.find");
			return;
		}
		const target = event.target;
		if (
			(key === "z" || key === "y") &&
			target instanceof HTMLElement &&
			!target.classList.contains("editor-input")
		)
			return;
		const id =
			key === "s"
				? "file.save"
				: key === "o"
					? event.shiftKey
						? "folder.open"
						: "file.open"
					: key === "z"
						? event.shiftKey
							? "edit.redo"
							: "edit.undo"
						: key === "y"
							? "edit.redo"
							: undefined;
		if (id) {
			event.preventDefault();
			void run(id);
		}
	};
	window.addEventListener("keydown", keydown);
	onCleanup(() => window.removeEventListener("keydown", keydown));
}
