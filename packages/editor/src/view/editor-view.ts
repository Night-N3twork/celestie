import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import { findTextChange } from "./input";

export class EditorView {
	private readonly element: HTMLTextAreaElement;
	private readonly subscription: Disposable;
	private readonly root: HTMLDivElement;
	private readonly gutter: HTMLPreElement;
	private readonly cursorLabel: HTMLDivElement;

	constructor(
		container: HTMLElement,
		private readonly model: TextModel,
	) {
		this.element = document.createElement("textarea");

		this.element.setAttribute("aria-label", "Editor");
		this.element.spellcheck = false;
		this.element.setAttribute("autocapitalize", "off");
		this.element.setAttribute("autocorrect", "off");
		this.element.autocomplete = "off";
		this.element.style.background = "#1e1e1e";
		this.element.style.color = "#d4d4d4";
		this.element.style.caretColor = "#ffffff";
		this.element.style.tabSize = "4";

		this.element.style.width = "100%";
		this.element.style.minHeight = "512px";
		this.element.style.boxSizing = "border-box";
		this.element.style.fontFamily = "monospace";
		this.element.style.fontSize = "16px";

		this.element.style.margin = "0";
		this.element.style.padding = "16px";
		this.element.style.overflow = "auto";

		this.root = document.createElement("div");
		this.root.style.cssText =
			"display: flex; height: min(75vh, 800px); min-height: 240px; overflow: hidden;";

		this.gutter = document.createElement("pre");
		this.gutter.setAttribute("aria-hidden", "true");
		this.gutter.style.cssText = `
			margin: 0;
			padding: 16px 8px;
			font: 16px/24px monospace;
			text-align: right;
			color: #858585;
			background: #1e1e1e;
			min-width: 3ch;
			overflow: hidden;
			flex-shrink: 0;
			user-select: none;
		`;

		this.element.wrap = "off";
		this.element.style.font = "16px/24px monospace";
		this.element.style.border = "0";
		this.element.style.resize = "none";
		this.element.style.flex = "1";
		this.element.style.minWidth = "0";
		this.element.style.minHeight = "0";
		this.element.style.width = "0";
		this.element.style.height = "100%";

		this.root.append(this.gutter, this.element);
		container.appendChild(this.root);

		this.cursorLabel = document.createElement("div");
		this.cursorLabel.style.cssText =
			"padding: 8px 12px; font: 12px monospace; text-align: right; color: #cccccc; background: #252526; border-top: 1px solid #3c3c3c;";

		container.appendChild(this.cursorLabel);

		for (const event of ["click", "keyup", "select"]) {
			this.element.addEventListener(event, this.updateCursor);
		}

		this.element.addEventListener("input", this.handleInput);
		this.element.addEventListener("scroll", this.handleScroll);

		this.render();
		this.element.setSelectionRange(0, 0);
		this.element.scrollTop = 0;
		this.handleScroll();
		this.updateCursor();

		this.subscription = model.onDidChangeContent(() => {
			this.render();
		});
	}

	focus(): void {
		this.element.focus();
	}

	private readonly updateCursor = (): void => {
		const offset =
			this.element.selectionDirection === "backward"
				? this.element.selectionStart
				: this.element.selectionEnd;

		const position = this.model.getPositionAt(offset);

		this.cursorLabel.textContent = `Ln ${position.line}, Col ${position.column}`;
	};

	private readonly handleScroll = (): void => {
		this.gutter.scrollTop = this.element.scrollTop;
	};

	private readonly handleInput = (): void => {
		const change = findTextChange(
			this.model.getValue(),
			this.element.value,
		);

		if (!change) return;

		const start = this.model.getPositionAt(change.from);
		const end = this.model.getPositionAt(change.to);

		this.model.edit([
			{
				range: {
					startLine: start.line,
					startColumn: start.column,
					endLine: end.line,
					endColumn: end.column,
				},
				text: change.text,
			},
		]);
	};

	private render(): void {
		const text = this.model.getValue();

		if (this.element.value !== text) {
			this.element.value = text;
		}

		const numbers = Array.from(
			{ length: this.model.getLineCount() },
			(_, index) => String(index + 1),
		);

		this.gutter.textContent = numbers.join("\n");
		this.handleScroll();
		this.updateCursor();
	}

	dispose(): void {
		this.element.removeEventListener("input", this.handleInput);
		this.element.removeEventListener("scroll", this.handleScroll);
		this.subscription.dispose();
		this.root.remove();
		for (const event of ["click", "keyup", "select"]) {
			this.element.removeEventListener(event, this.updateCursor);
		}

		this.cursorLabel.remove();
	}
}
