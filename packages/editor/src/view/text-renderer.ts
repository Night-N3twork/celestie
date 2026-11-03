import type { Disposable, Position, TextSelection } from "../api/types";
import type { SearchMatch } from "../features/search";
import type { TextModel } from "../model/text-model";
import "../styles/editor.css";
import { calculateViewport } from "./layout";
import { LineNumberGutter } from "./line-number-gutter";
import { TextGeometry } from "./text-geometry";

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
	private accessible = false;
	private readonly geometry: TextGeometry;
	private readonly selectionLayer: HTMLDivElement;
	private visible = { firstLine: 1, lastLine: 1 };
	private widest = 0;
	private rowsKey = "";
	private highlightRevision = 0;
	private dropOffset: number | undefined;
	get columnWidth(): number {
		return this.geometry.spaceWidth();
	}
	get interactionElement(): HTMLElement {
		return this.scroller;
	}
	get viewport(): HTMLElement {
		return this.accessible && this.input ? this.input : this.scroller;
	}
	private get scrollSource(): HTMLElement {
		return this.viewport;
	}
	private readonly input: HTMLTextAreaElement | undefined;
	private readonly padding: number;
	private readonly lineHeight = 24;
	private disposed = false;
	private activeLine = 0;
	private bracketKey = "";
	private selections: readonly TextSelection[] = [];
	private selectionKey = "";
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
		this.selectionLayer = document.createElement("div");
		this.selectionLayer.className = "editor-selection-layer";
		this.selectionLayer.setAttribute("aria-hidden", "true");
		this.surface.append(this.selectionLayer);
		this.geometry = new TextGeometry(
			this.scroller,
			this.surface,
			() => this.model,
			this.padding,
			this.lineHeight,
		);
		this.scroller.tabIndex = -1;
		this.scroller.appendChild(this.surface);
		if (this.input) {
			this.surface.setAttribute("aria-hidden", "true");
			this.root.classList.add(
				"editor-renderer-with-input",
				"editor-bounded-renderer",
			);
			this.input.classList.add("editor-native-input-bounded");
			this.scroller.appendChild(this.input);
		}
		this.root.appendChild(this.scroller);
		container.appendChild(this.root);
		this.scroller.addEventListener("scroll", this.render);
		this.input?.addEventListener("scroll", this.inputScroll);
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.resizeObserver = new ResizeObserver(this.render);
		this.resizeObserver.observe(this.scroller);
		this.render();
	}

	private readonly inputScroll = (): void => {
		if (this.accessible) this.render();
	};
	setAccessible(value: boolean): void {
		const top = this.scrollSource.scrollTop,
			left = this.scrollSource.scrollLeft;
		this.accessible = value;
		this.root.classList.toggle("editor-bounded-renderer", !value);
		this.input?.classList.toggle("editor-native-input-bounded", !value);
		if (this.input) {
			this.input.style.left = "";
			this.input.style.top = "";
		}
		this.render();
		this.scrollSource.scrollTop = top;
		this.scrollSource.scrollLeft = left;
		this.render();
	}
	hitTest(x: number, y: number): number {
		return this.geometry.hitTest(
			x,
			y,
			this.scrollSource.scrollTop,
			this.scrollSource.scrollLeft,
		);
	}
	point(position: Position): { x: number; y: number; height: number } {
		const point = this.geometry.point(position);
		const viewportRelative =
			this.accessible && this.geometry.hasLine(position.line);
		return {
			...point,
			x: point.x + (viewportRelative ? this.scrollSource.scrollLeft : 0),
			y: point.y + (viewportRelative ? this.scrollSource.scrollTop : 0),
		};
	}
	offsetAtLineX(line: number, x: number): number {
		const bounds = this.scroller.getBoundingClientRect();
		return this.hitTest(
			bounds.left + x - this.scrollSource.scrollLeft,
			bounds.top +
				this.padding +
				(line - 1) * this.lineHeight -
				this.scrollSource.scrollTop +
				this.lineHeight / 2,
		);
	}
	render = (): void => {
		if (this.disposed) return;
		const lineCount = this.model.getLineCount();
		const { scrollTop, scrollLeft, clientHeight, clientWidth } =
			this.scrollSource;
		const viewport = calculateViewport(
			lineCount,
			Math.max(0, scrollTop - this.padding),
			clientHeight,
			this.lineHeight,
		);
		this.visible = viewport;
		this.surface.style.height = `${this.accessible ? clientHeight : lineCount * this.lineHeight + 2 * this.padding}px`;
		this.surface.style.width = `${this.accessible ? clientWidth : Math.max(clientWidth, this.widest)}px`;
		this.rows.style.top = `${this.padding + viewport.offsetTop - (this.accessible ? scrollTop : 0)}px`;
		this.rows.style.left = `${this.padding - (this.accessible ? scrollLeft : 0)}px`;
		this.gutter.render({
			viewport,
			lineCount,
			scrollTop,
			viewportHeight: clientHeight,
			paddingTop: this.padding,
		});
		const rowsKey = `${this.model.id}:${this.model.getVersionId()}:${viewport.firstLine}:${viewport.lastLine}:${this.highlightRevision}`;
		if (rowsKey !== this.rowsKey) {
			this.rowsKey = rowsKey;
			const fragment =
				this.scroller.ownerDocument.createDocumentFragment();
			this.geometry.clear();
			for (
				let line = viewport.firstLine;
				line <= viewport.lastLine;
				line++
			) {
				const row = this.scroller.ownerDocument.createElement("div");
				row.dataset.line = String(line);
				row.style.height = `${this.lineHeight}px`;
				const text = this.model.getLineContent(line);
				this.appendHighlightedText(row, text, line);
				fragment.append(row);
				this.geometry.register(line, row, text);
			}
			this.rows.replaceChildren(fragment);
		}

		this.widest = Math.max(
			this.widest,
			this.rows.scrollWidth + 2 * this.padding,
		);
		if (!this.accessible)
			this.surface.style.width = `${Math.max(clientWidth, this.widest)}px`;
		this.positionActiveLine();
		this.paintSelections();
	};
	setDropOffset(offset: number | undefined): void {
		this.dropOffset = offset;
		this.paintSelections();
	}
	private paintSelections(): void {
		if (this.disposed) return;
		const fragment = this.surface.ownerDocument.createDocumentFragment();
		const rectangle = (
			name: string,
			x: number,
			y: number,
			width: number,
			height: number,
		) => {
			const element = this.surface.ownerDocument.createElement("div");
			element.className = name;
			element.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
			fragment.append(element);
		};
		const selections = this.accessible
			? this.selections.slice(1)
			: this.selections;
		for (const selection of selections) {
			const start = this.model.getPositionAtInputOffset(selection.start),
				end = this.model.getPositionAtInputOffset(selection.end);
			if (selection.start !== selection.end)
				for (
					let line = Math.max(start.line, this.visible.firstLine);
					line <= Math.min(end.line, this.visible.lastLine);
					line++
				) {
					const content = this.model.getLineContent(line),
						from = line === start.line ? start.column - 1 : 0,
						to =
							line === end.line ? end.column - 1 : content.length;
					for (const rect of this.geometry.rectangles(line, from, to))
						if (rect.width > 0)
							rectangle(
								"editor-custom-selection",
								rect.x,
								rect.y,
								rect.width,
								rect.height,
							);
					if (line < end.line) {
						const point = this.geometry.point({
							line,
							column: content.length + 1,
						});
						rectangle(
							"editor-custom-selection",
							point.x,
							point.y,
							8,
							this.lineHeight,
						);
					}
				}
			const active = selection.direction === "backward" ? start : end;
			if (
				active.line >= this.visible.firstLine &&
				active.line <= this.visible.lastLine
			) {
				const point = this.geometry.point(active);
				rectangle(
					"editor-custom-caret",
					point.x,
					point.y,
					2,
					point.height,
				);
			}
		}
		if (this.dropOffset !== undefined) {
			const point = this.geometry.point(
				this.model.getPositionAtInputOffset(this.dropOffset),
			);
			rectangle(
				"editor-custom-caret editor-drop-caret",
				point.x,
				point.y,
				2,
				point.height,
			);
		}
		this.selectionLayer.replaceChildren(fragment);
		if (this.input && !this.accessible && this.selections[0]) {
			const selection = this.selections[0],
				offset =
					selection.direction === "backward"
						? selection.start
						: selection.end;
			const point = this.geometry.point(
				this.model.getPositionAtInputOffset(offset),
			);
			this.input.style.left = `${Math.max(this.scroller.scrollLeft, Math.min(point.x, this.scroller.scrollLeft + this.scroller.clientWidth - 4))}px`;
			this.input.style.top = `${Math.max(this.scroller.scrollTop, Math.min(point.y, this.scroller.scrollTop + this.scroller.clientHeight - this.lineHeight))}px`;
		}
	}

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

	setSelections(selections: readonly TextSelection[]): void {
		const key = JSON.stringify(selections);
		if (key === this.selectionKey) return;
		this.selectionKey = key;
		this.selections = selections.map((value) => ({ ...value }));
		this.paintSelections();
	}
	setBracketMatches(positions: readonly Position[]): void {
		const key = positions
			.map(({ line, column }) => `${line}:${column}`)
			.sort()
			.join(",");
		if (this.disposed || key === this.bracketKey) return;
		this.bracketKey = key;
		this.highlightRevision++;
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
		this.highlightRevision++;
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
		this.geometry.setTabSize(size);
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
		this.widest = 0;
		this.rowsKey = "";
		this.selections = [];
		this.selectionKey = "";
		this.render();
	}

	private positionActiveLine(): void {
		this.activeLineHighlight.hidden =
			this.activeLine < 1 || this.activeLine > this.model.getLineCount();
		this.activeLineHighlight.style.top = `${this.padding + (this.activeLine - 1) * this.lineHeight - (this.accessible ? this.scrollSource.scrollTop : 0)}px`;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.scroller.removeEventListener("scroll", this.render);
		this.input?.removeEventListener("scroll", this.inputScroll);
		this.geometry.clear();
		this.subscription?.dispose();
		this.gutter.dispose();
		this.subscription = undefined;
		this.modelValue = undefined;
		this.selections = [];
		this.selectionKey = "";
		this.rows.replaceChildren();
		this.searchHighlights.clear();
		this.bracketHighlights.clear();
		this.root.remove();
	}
}
