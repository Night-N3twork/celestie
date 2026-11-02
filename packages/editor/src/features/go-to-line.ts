import type { Disposable } from "../api/types";
import { TextBuffer } from "../model/text-buffer";
import type { KeyboardShortcuts } from "./keyboard-shortcuts";

interface GoToLineHost {
	onOpen(): void;
	getText(): string;
	getPosition(): { line: number; column: number };
	selectOffset(offset: number): void;
	focusEditor(): void;
}

export class GoToLine implements Disposable {
	private readonly panel: HTMLDivElement;
	private readonly input: HTMLInputElement;
	private readonly status: HTMLSpanElement;
	private readonly subscriptions: Disposable[] = [];
	private disposed = false;

	constructor(
		container: HTMLElement,
		private readonly host: GoToLineHost,
		shortcuts: KeyboardShortcuts,
	) {
		const document = container.ownerDocument;
		this.panel = document.createElement("div");
		this.panel.className = "editor-find-panel editor-go-to-panel";
		this.panel.hidden = true;
		this.panel.setAttribute("role", "group");
		this.panel.setAttribute("aria-label", "Go to line and column");
		const row = document.createElement("div");
		row.className = "editor-find-row";
		this.input = document.createElement("input");
		this.input.type = "text";
		this.input.placeholder = "Line or line:column";
		this.input.setAttribute("aria-label", "Line or line:column");
		this.input.spellcheck = false;
		this.status = document.createElement("span");
		this.status.setAttribute("role", "status");
		const button = (label: string, run: () => void): HTMLButtonElement => {
			const element = document.createElement("button");
			element.type = "button";
			element.textContent = label;
			element.addEventListener("click", run);
			this.subscriptions.push({
				dispose: () => element.removeEventListener("click", run),
			});
			return element;
		};
		row.append(
			this.input,
			button("Go", this.go),
			button("Close", () => this.close()),
		);
		this.panel.append(row, this.status);
		container.prepend(this.panel);
		this.subscriptions.push(
			shortcuts.register({
				id: "editor.goToLine",
				key: "g",
				ctrl: true,
				run: () => this.open(),
			}),
			shortcuts.registerScope(this.panel, [
				{
					id: "goTo.apply",
					key: "Enter",
					when: () => document.activeElement === this.input,
					run: this.go,
				},
				{ id: "goTo.close", key: "Escape", run: () => this.close() },
			]),
		);
	}

	open(): void {
		if (this.disposed) return;
		this.host.onOpen();
		const position = this.host.getPosition();
		this.input.value = `${position.line}:${position.column}`;
		this.input.removeAttribute("aria-invalid");
		this.status.textContent = "Use 1-based line and column numbers.";
		this.panel.hidden = false;
		this.input.focus();
		this.input.select();
	}

	close(focus = true): void {
		this.panel.hidden = true;
		if (focus) this.host.focusEditor();
	}

	private readonly go = (): void => {
		const match = /^(\d+)(?::(\d+))?$/.exec(this.input.value.trim());
		const line = Number(match?.[1]);
		const column = Number(match?.[2] ?? 1);
		const buffer = new TextBuffer(this.host.getText());
		let error = "Enter a line number or line:column.";
		if (match) {
			if (
				!Number.isSafeInteger(line) ||
				line < 1 ||
				line > buffer.getLineCount()
			) {
				error = `Line must be between 1 and ${buffer.getLineCount()}.`;
			} else {
				const maxColumn = buffer.getLineContent(line).length + 1;
				if (
					Number.isSafeInteger(column) &&
					column >= 1 &&
					column <= maxColumn
				) {
					this.host.selectOffset(
						buffer.getOffsetAt({ line, column }),
					);
					this.close();
					return;
				}
				error = `Column must be between 1 and ${maxColumn} on line ${line}.`;
			}
		}
		this.status.textContent = error;
		this.input.setAttribute("aria-invalid", "true");
		this.input.focus();
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const subscription of this.subscriptions.reverse())
			subscription.dispose();
		this.panel.remove();
	}
}
