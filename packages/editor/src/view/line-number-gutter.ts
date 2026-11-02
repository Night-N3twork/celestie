import type { calculateViewport } from "./layout";

interface GutterLayout {
	readonly viewport: ReturnType<typeof calculateViewport>;
	readonly lineCount: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly paddingTop?: number;
}

export class LineNumberGutter {
	private readonly element: HTMLDivElement;
	private readonly numbers: HTMLDivElement;
	private firstLine = 0;
	private lastLine = 0;
	private activeLine = 0;

	constructor(
		container: HTMLElement,
		private readonly lineHeight = 24,
		private readonly onSelectLine?: (line: number) => void,
	) {
		const document = container.ownerDocument;
		this.element = document.createElement("div");
		this.element.className = "editor-gutter";
		if (onSelectLine)
			this.element.classList.add("editor-gutter-interactive");
		this.element.setAttribute("aria-hidden", "true");
		this.element.style.cssText = `
			position: relative;
			overflow: hidden;
			flex: none;
			font: 16px/${lineHeight}px monospace;
			color: #858585;
			background: #1e1e1e;
			text-align: right;
			user-select: none;
		`;
		this.numbers = document.createElement("div");
		this.numbers.style.cssText = "position: absolute; inset: 0 8px auto;";
		this.element.appendChild(this.numbers);
		container.appendChild(this.element);
		this.element.addEventListener("pointerdown", this.handlePointerDown);
	}

	render(layout: GutterLayout): void {
		const {
			viewport,
			lineCount,
			scrollTop,
			viewportHeight,
			paddingTop = 0,
		} = layout;
		const digits = Math.max(3, String(lineCount).length);
		this.element.style.width = `calc(${digits}ch + 16px)`;
		this.element.style.height = `${viewportHeight}px`;
		this.numbers.style.transform = `translateY(${paddingTop + viewport.offsetTop - scrollTop}px)`;

		if (
			this.firstLine === viewport.firstLine &&
			this.lastLine === viewport.lastLine
		)
			return;
		const fragment = this.element.ownerDocument.createDocumentFragment();
		for (let line = viewport.firstLine; line <= viewport.lastLine; line++) {
			const number = this.element.ownerDocument.createElement("div");
			number.dataset.line = String(line);
			number.classList.toggle("is-active", line === this.activeLine);
			number.style.height = `${this.lineHeight}px`;
			number.textContent = String(line);
			fragment.appendChild(number);
		}
		this.numbers.replaceChildren(fragment);
		this.firstLine = viewport.firstLine;
		this.lastLine = viewport.lastLine;
	}

	setActiveLine(line: number): void {
		if (line === this.activeLine) return;
		this.activeLine = line;
		for (const number of this.numbers.children) {
			number.classList.toggle(
				"is-active",
				Number(number.getAttribute("data-line")) === line,
			);
		}
	}

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (
			event.button !== 0 ||
			!this.onSelectLine ||
			!(event.target instanceof Element)
		)
			return;
		const number = event.target.closest<HTMLElement>("[data-line]");
		if (!number || !this.numbers.contains(number)) return;
		event.preventDefault();
		this.onSelectLine(Number(number.dataset.line));
	};

	dispose(): void {
		this.element.removeEventListener("pointerdown", this.handlePointerDown);
		this.element.remove();
	}
}
