import type { Disposable, Position } from "../api/types";
import type { SearchMatch } from "../features/search";
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
	private modelValue: TextModel | undefined;
	private get model(): TextModel {
		if (!this.modelValue) throw new Error("Renderer disposed.");
		return this.modelValue;
	}
	private set model(value: TextModel) {
		this.modelValue = value;
	}
	private readonly root: HTMLDivElement;
	private readonly gutter: LineNumberGutter;
	private readonly scroller: HTMLDivElement;
	private readonly surface: HTMLDivElement;
	private readonly rows: HTMLDivElement;
	private readonly activeLineHighlight: HTMLDivElement;
	private subscription: Disposable | undefined;
	private readonly resizeObserver: ResizeObserver;
	private readonly scrollSource: HTMLElement;
	private readonly input: HTMLTextAreaElement | undefined;
	private readonly padding: number;
	private readonly lineHeight = 24;
	private disposed = false;
	private activeLine = 0;
	private bracketKey = "";
	private readonly bracketHighlights = new Map<number, number[]>();
	private readonly searchHighlights = new Map<
		number,
		{ from: number; to: number; current: boolean }[]
	>();

	constructor(
		container: HTMLElement,
		model: TextModel,
		options: TextRendererOptions = {},
	) {
		this.model = model;
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
			const text = this.model.getLineContent(line);
			this.appendHighlightedText(row, text, line);
			fragment.appendChild(row);
		}
		this.rows.replaceChildren(fragment);
		this.positionActiveLine();
	};

	private appendHighlightedText(
		row: HTMLElement,
		text: string,
		line: number,
	): void {
		const events = new Map<
			number,
			{ add: string[]; remove: string[]; empty: string[] }
		>();
		const eventAt = (offset: number) => {
			const event = events.get(offset) ?? {
				add: [],
				remove: [],
				empty: [],
			};
			events.set(offset, event);
			return event;
		};
		const mark = (from: number, to: number, name: string) => {
			eventAt(from).add.push(name);
			eventAt(to).remove.push(name);
		};
		for (const highlight of this.searchHighlights.get(line) ?? []) {
			if (highlight.from === highlight.to) {
				eventAt(highlight.from).empty.push(
					`editor-find-empty-match${highlight.current ? " editor-find-match-current" : ""}`,
				);
				continue;
			}
			mark(highlight.from, highlight.to, "editor-find-match");
			if (highlight.current)
				mark(highlight.from, highlight.to, "editor-find-match-current");
		}
		for (const column of this.bracketHighlights.get(line) ?? [])
			mark(column, column + 1, "editor-matching-bracket");
		const active = new Set<string>();
		let cursor = 0;
		const append = (end: number) => {
			if (end <= cursor) return;
			const content = text.slice(cursor, end);
			if (active.size) {
				const span = row.ownerDocument.createElement("span");
				span.className = [...active].join(" ");
				span.textContent = content;
				row.append(span);
			} else row.append(row.ownerDocument.createTextNode(content));
			cursor = end;
		};
		for (const [offset, event] of [...events].sort(
			([left], [right]) => left - right,
		)) {
			append(Math.min(text.length, offset));
			for (const name of event.empty) {
				const marker = row.ownerDocument.createElement("span");
				marker.className = name;
				row.append(marker);
			}
			for (const name of event.remove) active.delete(name);
			for (const name of event.add) active.add(name);
		}
		append(text.length);
	}

	setBracketMatches(positions: readonly Position[]): void {
		const key = positions
			.map(({ line, column }) => `${line}:${column}`)
			.sort()
			.join(",");
		if (this.disposed || key === this.bracketKey) return;
		this.bracketKey = key;
		this.bracketHighlights.clear();
		for (const { line, column } of positions) {
			const list = this.bracketHighlights.get(line) ?? [];
			list.push(column - 1);
			this.bracketHighlights.set(line, list);
		}
		this.render();
	}

	setSearchMatches(matches: readonly SearchMatch[], current: number): void {
		if (this.disposed) return;
		this.searchHighlights.clear();
		for (let index = 0; index < matches.length; index++) {
			const match = matches[index];
			if (!match) continue;
			for (
				let line = match.range.startLine;
				line <= match.range.endLine;
				line++
			) {
				const from =
					line === match.range.startLine
						? match.range.startColumn - 1
						: 0;
				const to =
					line === match.range.endLine
						? match.range.endColumn - 1
						: this.model.getLineContent(line).length;
				if (to < from || (to === from && match.from !== match.to))
					continue;
				const list = this.searchHighlights.get(line) ?? [];
				list.push({ from, to, current: index === current });
				this.searchHighlights.set(line, list);
			}
		}
		this.render();
	}

	setActiveLine(line: number): void {
		if (line === this.activeLine || this.disposed) return;
		this.activeLine = line;
		this.gutter.setActiveLine(line);
		this.positionActiveLine();
	}

	setTabSize(size: number): void {
		this.root.style.tabSize = String(size);
		this.render();
	}

	setModel(model: TextModel): void {
		if (this.disposed) throw new Error("Renderer disposed.");
		this.subscription?.dispose();
		this.model = model;
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.searchHighlights.clear();
		this.bracketHighlights.clear();
		this.bracketKey = "";
		this.activeLine = 0;
		this.render();
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
		this.subscription = undefined;
		this.modelValue = undefined;
		this.rows.replaceChildren();
		this.searchHighlights.clear();
		this.bracketHighlights.clear();
		this.root.remove();
	}
}
