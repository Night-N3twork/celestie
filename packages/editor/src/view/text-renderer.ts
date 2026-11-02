import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import "../styles/editor.css";
import { calculateViewport } from "./layout";
import { LineNumberGutter } from "./line-number-gutter";

interface TextRendererOptions {
	readonly input?: HTMLTextAreaElement;
	readonly padding?: number;
	readonly height?: string;
	readonly onSelectLine?: (line: number) => void;
}

export class TextRenderer implements Disposable {
	private readonly root: HTMLDivElement;
	private readonly gutter: LineNumberGutter;
	private readonly scroller: HTMLDivElement;
	private readonly surface: HTMLDivElement;
	private readonly rows: HTMLDivElement;
	private readonly activeLineHighlight: HTMLDivElement;
	private readonly subscription: Disposable | undefined;
	private readonly resizeObserver: ResizeObserver;
	private readonly scrollSource: HTMLElement;
	private readonly input: HTMLTextAreaElement | undefined;
	private readonly padding: number;
	private readonly lineHeight = 24;
	private disposed = false;
	private activeLine = 0;

	constructor(
		container: HTMLElement,
		private readonly model: TextModel,
		options: TextRendererOptions = {},
	) {
		const document = container.ownerDocument;
		this.input = options.input;
		this.padding = options.padding ?? 0;
		this.root = document.createElement("div");
		this.root.className = "editor-renderer";
		this.root.style.height = options.height ?? "512px";
		this.gutter = new LineNumberGutter(
			this.root,
			this.lineHeight,
			options.onSelectLine,
		);
		this.scroller = document.createElement("div");
		this.scroller.className = "editor-text-viewport";
		this.surface = document.createElement("div");
		this.surface.className = "editor-text-surface";
		this.rows = document.createElement("div");
		this.rows.className = "editor-text-rows";
		this.activeLineHighlight = document.createElement("div");
		this.activeLineHighlight.className = "editor-active-line";
		this.activeLineHighlight.hidden = true;
		this.activeLineHighlight.setAttribute("aria-hidden", "true");
		this.surface.appendChild(this.activeLineHighlight);
		this.surface.appendChild(this.rows);
		this.scroller.appendChild(this.surface);
		if (this.input) {
			this.surface.setAttribute("aria-hidden", "true");
			this.root.classList.add("editor-renderer-with-input");
			this.scroller.appendChild(this.input);
		}
		this.root.appendChild(this.scroller);
		container.appendChild(this.root);
		this.scrollSource = this.input ?? this.scroller;
		this.scrollSource.addEventListener("scroll", this.render);
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.resizeObserver = new ResizeObserver(this.render);
		this.resizeObserver.observe(this.scrollSource);
		this.render();
	}

	render = (): void => {
		if (this.disposed) return;
		const lineCount = this.model.getLineCount();
		if (!this.input) {
			this.surface.style.height = `${lineCount * this.lineHeight + 2 * this.padding}px`;
		}
		const { scrollTop, scrollLeft, clientHeight, clientWidth } =
			this.scrollSource;
		const viewport = calculateViewport(
			lineCount,
			Math.max(0, scrollTop - this.padding),
			clientHeight,
			this.lineHeight,
		);
		if (this.input) {
			this.surface.style.width = `${clientWidth}px`;
			this.surface.style.height = `${clientHeight}px`;
		}
		this.rows.style.top = `${this.padding + viewport.offsetTop - (this.input ? scrollTop : 0)}px`;
		this.rows.style.left = `${this.padding - (this.input ? scrollLeft : 0)}px`;
		this.gutter.render({
			viewport,
			lineCount,
			scrollTop,
			viewportHeight: clientHeight,
			paddingTop: this.padding,
		});
		const fragment = this.scroller.ownerDocument.createDocumentFragment();
		for (let line = viewport.firstLine; line <= viewport.lastLine; line++) {
			const row = this.scroller.ownerDocument.createElement("div");
			row.dataset.line = String(line);
			row.style.height = `${this.lineHeight}px`;
			row.textContent = this.model.getLineContent(line);
			fragment.appendChild(row);
		}
		this.rows.replaceChildren(fragment);
		this.positionActiveLine();
	};

	setActiveLine(line: number): void {
		if (line === this.activeLine || this.disposed) return;
		this.activeLine = line;
		this.gutter.setActiveLine(line);
		this.positionActiveLine();
	}

	private positionActiveLine(): void {
		this.activeLineHighlight.hidden =
			this.activeLine < 1 || this.activeLine > this.model.getLineCount();
		this.activeLineHighlight.style.top = `${this.padding + (this.activeLine - 1) * this.lineHeight - (this.input ? this.scrollSource.scrollTop : 0)}px`;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.scrollSource.removeEventListener("scroll", this.render);
		this.subscription?.dispose();
		this.gutter.dispose();
		this.root.remove();
	}
}
