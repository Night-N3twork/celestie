import { defaultViewOptions, type EditorOptions } from "../api/editor-options";
import type { InlayHint, Token } from "../api/languages";
import type { Disposable, Position, TextSelection } from "../api/types";
import type { VisibleDecoration } from "../features/decorations";
import type { SearchMatch } from "../features/search";
import { applyTheme } from "../features/themes";
import type { TextModel } from "../model/text-model";
import "../styles/editor.css";
import { LineNumberGutter } from "./line-number-gutter";
import { TextGeometry } from "./text-geometry";
import { type FoldRegion, VisualLayout, type VisualRow } from "./visual-layout";

interface TextRendererOptions {
	readonly input?: HTMLTextAreaElement;
	readonly padding?: number;
	readonly height?: string;
	readonly onSelectLine?: (line: number) => void;
}
export interface ScrollAnchor {
	readonly line: number;
	readonly column: number;
	readonly offset: number;
	readonly left: number;
	readonly zone?: boolean;
}
export class TextRenderer implements Disposable {
	private modelValue: TextModel | undefined;
	private get model(): TextModel {
		if (!this.modelValue) throw new Error("Renderer disposed.");
		return this.modelValue;
	}
	private readonly root: HTMLDivElement;
	private readonly gutter: LineNumberGutter;
	private readonly scroller: HTMLDivElement;
	private readonly surface: HTMLDivElement;
	private readonly rows: HTMLDivElement;
	private readonly selectionLayer: HTMLDivElement;
	private readonly rulerLayer: HTMLDivElement;
	private readonly minimap: HTMLCanvasElement;
	private readonly overview: HTMLDivElement;
	private readonly sticky: HTMLDivElement;
	private readonly input: HTMLTextAreaElement | undefined;
	private readonly geometry: TextGeometry;
	readonly layout: VisualLayout;
	private readonly resizeObserver: ResizeObserver;
	private subscription: Disposable | undefined;
	private options: EditorOptions = {
		...defaultViewOptions,
		tabSize: 4,
		insertSpaces: false,
		readOnly: false,
		tabFocusMode: false,
		accessibilitySupport: "auto",
	};
	private accessible = false;
	private disposed = false;
	private readonly padding: number;
	private activeLine = 1;
	private selections: readonly TextSelection[] = [];
	private folds: readonly FoldRegion[] = [];
	private tokens: readonly Token[] = [];
	private hints: readonly InlayHint[] = [];
	private lenses: readonly {
		line: number;
		label: string;
		run: () => void;
	}[] = [];
	private assistanceVersion = -1;
	private decorations: readonly VisibleDecoration[] = [];
	private search: readonly SearchMatch[] = [];
	private currentMatch = -1;
	private brackets: readonly Position[] = [];
	private rowsKey = "";
	private revision = 0;
	private visible: VisualRow[] = [];
	private widest = 0;
	private dropOffset: number | undefined;
	private paintedVersion = -1;
	private readonly widgets = new Map<
		string,
		{
			node: HTMLElement;
			position: () => Position;
			placement: "above" | "below" | "inline";
			model: TextModel;
		}
	>();
	get lineHeight(): number {
		return this.options.lineHeight;
	}
	get columnWidth(): number {
		return this.geometry.spaceWidth();
	}
	get interactionElement(): HTMLElement {
		return this.scroller;
	}
	get viewport(): HTMLElement {
		return this.accessible && this.input ? this.input : this.scroller;
	}
	constructor(
		container: HTMLElement,
		model: TextModel,
		private readonly callbacks: TextRendererOptions = {},
	) {
		this.modelValue = model;
		this.input = callbacks.input;
		this.padding = callbacks.padding ?? 16;
		const doc = container.ownerDocument;
		this.root = doc.createElement("div");
		this.root.className = "editor-renderer editor-bounded-renderer";
		this.root.style.height = callbacks.height ?? "512px";
		this.gutter = new LineNumberGutter(this.root);
		this.scroller = doc.createElement("div");
		this.scroller.className = "editor-text-viewport";
		this.scroller.tabIndex = -1;
		this.surface = doc.createElement("div");
		this.surface.className = "editor-text-surface";
		this.rows = doc.createElement("div");
		this.rows.className = "editor-text-rows";
		this.selectionLayer = doc.createElement("div");
		this.selectionLayer.className = "editor-selection-layer";
		this.selectionLayer.setAttribute("aria-hidden", "true");
		this.rulerLayer = doc.createElement("div");
		this.rulerLayer.className = "editor-ruler-layer";
		this.rulerLayer.setAttribute("aria-hidden", "true");
		this.surface.append(this.rulerLayer, this.rows, this.selectionLayer);
		this.scroller.append(this.surface);
		this.sticky = doc.createElement("div");
		this.sticky.className = "editor-sticky";
		this.scroller.append(this.sticky);
		if (this.input) {
			this.root.classList.add("editor-renderer-with-input");
			this.input.classList.add("editor-native-input-bounded");
			this.scroller.append(this.input);
		}
		this.minimap = doc.createElement("canvas");
		this.minimap.className = "editor-minimap";
		this.minimap.tabIndex = 0;
		this.minimap.setAttribute("aria-label", "Document overview");
		this.overview = doc.createElement("div");
		this.overview.className = "editor-overview";
		this.root.append(this.scroller, this.minimap, this.overview);
		container.append(this.root);
		this.layout = new VisualLayout(
			() => this.model,
			(text) => this.geometry.measure(text),
		);
		this.geometry = new TextGeometry(
			this.scroller,
			this.surface,
			() => this.model,
			this.layout,
			this.padding,
		);
		this.scroller.addEventListener("scroll", this.render);
		this.input?.addEventListener("scroll", this.inputScroll);
		this.minimap.addEventListener("pointerdown", this.mapClick);
		this.minimap.addEventListener("keydown", this.mapKey);
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.resizeObserver = new ResizeObserver(() => {
			const anchor = this.captureAnchor();
			this.render();
			this.restoreAnchor(anchor);
		});
		this.resizeObserver.observe(this.scroller);
		this.root.ownerDocument.fonts?.addEventListener(
			"loadingdone",
			this.fontsChanged,
		);
		this.configure(this.options);
	}
	private readonly fontsChanged = (): void => {
		const anchor = this.captureAnchor();
		this.geometry.resetMeasurements();
		this.layout.invalidate();
		this.revision++;
		this.render();
		this.restoreAnchor(anchor);
	};
	private readonly inputScroll = (): void => {
		if (this.accessible) this.render();
	};
	configure(options: EditorOptions): void {
		const anchor = this.captureAnchor();
		this.options = options;
		this.root.style.fontFamily = options.fontFamily;
		this.root.style.fontSize = `${options.fontSize}px`;
		this.root.style.lineHeight = `${options.lineHeight}px`;
		this.root.style.tabSize = String(options.tabSize);
		this.geometry.lineHeight = options.lineHeight;
		this.geometry.setTabSize(options.tabSize);
		this.geometry.resetMeasurements();
		this.layout.invalidate();
		applyTheme(this.root, options.theme);
		this.root
			.closest<HTMLElement>(".editor-view-frame")
			?.setAttribute("data-theme", options.theme);
		const frame = this.root.closest<HTMLElement>(".editor-view-frame");
		frame?.style.setProperty("--editor-font-family", options.fontFamily);
		frame?.style.setProperty("--editor-font-size", `${options.fontSize}px`);
		frame?.style.setProperty(
			"--editor-line-height",
			`${options.lineHeight}px`,
		);
		if (frame)
			for (const [key, value] of Array.from(this.root.style)
				.filter((key) => key.startsWith("--editor-"))
				.map(
					(key) =>
						[key, this.root.style.getPropertyValue(key)] as const,
				))
				frame.style.setProperty(key, value);
		this.minimap.hidden = !options.minimap;
		this.revision++;
		this.render();
		this.restoreAnchor(anchor);
	}
	setAccessible(value: boolean): void {
		const anchor = this.captureAnchor();
		this.accessible = value;
		this.root.classList.toggle("editor-bounded-renderer", !value);
		this.input?.classList.toggle("editor-native-input-bounded", !value);
		if (this.input) {
			this.input.style.left = "";
			this.input.style.top = "";
		}
		this.render();
		this.restoreAnchor(anchor);
	}
	captureAnchor(): ScrollAnchor {
		if (!this.layout?.rowCount)
			return {
				line: 1,
				column: 1,
				offset: 0,
				left: this.viewport?.scrollLeft ?? 0,
			};
		const row = this.layout.row(
			Math.floor(
				Math.max(0, this.viewport.scrollTop - this.padding) /
					this.lineHeight,
			),
		);
		return {
			line: row.line,
			column: row.from + 1,
			...(row.kind === "zone" ? { zone: true } : {}),
			offset:
				this.viewport.scrollTop -
				(this.padding + row.index * this.lineHeight),
			left: this.viewport.scrollLeft,
		};
	}
	restoreAnchor(anchor: ScrollAnchor): void {
		if (this.disposed) return;
		let row = this.layout.position(anchor.line, anchor.column);
		if (anchor.zone && this.layout.row(row.index - 1).kind === "zone")
			row = this.layout.row(row.index - 1);
		this.viewport.scrollTop = Math.max(
			0,
			this.padding + row.index * this.lineHeight + anchor.offset,
		);
		this.viewport.scrollLeft = anchor.left;
		this.render();
	}
	lineTop(line: number): number {
		return (
			this.padding + this.layout.position(line, 1).index * this.lineHeight
		);
	}
	lineAtScrollOffset(top: number): number {
		return this.layout.row(
			Math.floor(Math.max(0, top - this.padding) / this.lineHeight),
		).line;
	}
	setFolds(folds: readonly FoldRegion[]): void {
		this.folds = folds;
		this.render();
	}
	setTokens(tokens: readonly Token[]): void {
		this.tokens = tokens;
		this.revision++;
		this.render();
	}
	setAssistance(
		hints: readonly InlayHint[],
		lenses: readonly { line: number; label: string; run: () => void }[],
	): void {
		this.hints = hints;
		this.lenses = lenses;
		this.assistanceVersion = this.model.getVersionId();
		this.revision++;
		this.render();
	}

	setDecorations(values: readonly VisibleDecoration[]): void {
		this.decorations = values;
		this.revision++;
		this.render();
	}
	hitTest(x: number, y: number): number {
		return this.geometry.hitTest(
			x,
			y,
			this.viewport.scrollTop,
			this.viewport.scrollLeft,
		);
	}
	point(
		position: Position,
		affinity: "before" | "after" = "after",
	): { x: number; y: number; height: number } {
		const point = this.geometry.point(position, affinity),
			relative = this.accessible && this.geometry.hasLine(position.line);
		return {
			...point,
			x: point.x + (relative ? this.viewport.scrollLeft : 0),
			y: point.y + (relative ? this.viewport.scrollTop : 0),
		};
	}
	offsetAtLineX(line: number, x: number): number {
		return this.geometry.offsetAtRowX(
			this.layout.position(line, 1).index,
			x,
		);
	}
	verticalOffset(
		offset: number,
		rows: number,
		x: number,
		affinity: "before" | "after" = "after",
	): number {
		const position = this.model.getPositionAtInputOffset(offset),
			row = this.layout.position(
				position.line,
				position.column,
				affinity,
			);
		return this.geometry.offsetAtRowX(row.index + rows, x);
	}
	visualAffinity(index: number, offset: number): "before" | "after" {
		const row = this.layout.row(index),
			position = this.model.getPositionAtInputOffset(offset);
		return position.line === row.line &&
			position.column - 1 === row.to &&
			row.to < this.model.getLineContent(row.line).length
			? "before"
			: "after";
	}
	verticalMove(
		offset: number,
		rows: number,
		x: number,
		affinity: "before" | "after" = "after",
	): { offset: number; affinity: "before" | "after" } {
		const position = this.model.getPositionAtInputOffset(offset),
			current = this.layout.position(
				position.line,
				position.column,
				affinity,
			);
		let row = this.layout.row(current.index + rows);
		if (row.kind === "zone")
			row = this.layout.row(row.index + (rows < 0 ? -1 : 1));
		const target = this.geometry.offsetAtRowX(row.index, x);
		return {
			offset: target,
			affinity: this.visualAffinity(row.index, target),
		};
	}

	rowBoundary(
		offset: number,
		end: boolean,
		affinity: "before" | "after" = "after",
	): number {
		const position = this.model.getPositionAtInputOffset(offset),
			row = this.layout.position(
				position.line,
				position.column,
				affinity,
			);
		return this.model.getInputOffsetAt({
			line: row.line,
			column: (end ? row.to : row.from) + 1,
		});
	}
	render = (): void => {
		if (this.disposed) return;
		const source = this.viewport,
			width = Math.max(32, source.clientWidth - 2 * this.padding);
		const changed = this.layout.update(
			this.options,
			width,
			this.folds,
			this.accessible,
			this.options.codeLens &&
				!this.accessible &&
				this.assistanceVersion === this.model.getVersionId()
				? this.lenses.map((lens) => lens.line)
				: [],
			this.options.inlayHints &&
				!this.accessible &&
				this.assistanceVersion === this.model.getVersionId()
				? this.hints
				: [],
		);
		if (changed) {
			this.rowsKey = "";
			this.widest = 0;
		}
		const first = Math.max(
				0,
				Math.floor(
					(source.scrollTop - this.padding) / this.lineHeight,
				) - 4,
			),
			last = Math.min(
				this.layout.rowCount - 1,
				Math.ceil(
					(source.scrollTop + source.clientHeight - this.padding) /
						this.lineHeight,
				) + 4,
			);
		this.visible = [];
		for (let index = first; index <= last; index++)
			this.visible.push(this.layout.row(index));
		this.surface.style.height = `${this.accessible ? source.clientHeight : this.layout.rowCount * this.lineHeight + 2 * this.padding}px`;
		this.surface.style.width = `${this.accessible ? source.clientWidth : Math.max(source.clientWidth, this.widest)}px`;
		this.rows.style.top = "0";
		this.rows.style.left = "0";
		const key = `${this.model.id}:${this.model.getVersionId()}:${first}:${last}:${this.revision}:${this.accessible ? `${source.scrollTop},${source.scrollLeft}` : ""}`;
		if (key !== this.rowsKey) {
			this.rowsKey = key;
			const fragment = this.root.ownerDocument.createDocumentFragment();
			this.geometry.clear();
			for (const row of this.visible) {
				const element = this.root.ownerDocument.createElement("div");
				element.dataset.line = String(row.line);
				element.dataset.from = String(row.from);
				element.className = "editor-visual-row";
				element.style.minWidth = `${Math.max(0, source.clientWidth - 2 * this.padding - row.indent)}px`;
				element.style.cssText = `position:absolute;top:${this.padding + row.index * this.lineHeight - (this.accessible ? source.scrollTop : 0)}px;left:${this.padding + row.indent - (this.accessible ? source.scrollLeft : 0)}px;height:${this.lineHeight}px;line-height:${this.lineHeight}px`;
				element.classList.toggle(
					"editor-active-visual-line",
					row.line === this.activeLine,
				);
				if (row.kind === "zone") {
					element.classList.add("editor-code-lens");
					element.dataset.editorWidget = "code-lens";
					for (const lens of this.lenses.filter(
						(lens) => lens.line === row.line,
					)) {
						const button =
							this.root.ownerDocument.createElement("button");
						button.type = "button";
						button.textContent = lens.label;
						button.onclick = lens.run;
						element.append(button);
					}
				} else {
					element.setAttribute("aria-hidden", "true");
					this.appendText(element, row);
				}
				fragment.append(element);
				if (row.kind !== "zone") this.geometry.register(row, element);
			}
			this.rows.replaceChildren(fragment);
		}
		this.widest = Math.max(
			this.widest,
			...Array.from(
				this.rows.children,
				(element) =>
					(element as HTMLElement).offsetLeft +
					(element as HTMLElement).offsetWidth +
					this.padding,
			),
		);
		if (!this.accessible)
			this.surface.style.width = `${Math.max(source.clientWidth, this.widest)}px`;
		const glyphs = new Map<
			number,
			{ label: string; title: string; color: string }
		>();
		for (const decoration of this.decorations)
			if (decoration.gutter)
				glyphs.set(decoration.range.startLine, {
					label: decoration.gutter,
					title: decoration.hover ?? "",
					color: decoration.overview ?? "var(--editor-accent)",
				});
		this.gutter.renderRows(
			this.visible,
			source.scrollTop,
			source.clientHeight,
			this.lineHeight,
			this.padding,
			this.model.getLineCount(),
			this.activeLine,
			this.options.lineNumbers,
			this.accessible ? [] : this.folds,
			glyphs,
		);
		this.paintedVersion = this.model.getVersionId();
		this.paintSelections();
		this.paintOverview();
		this.paintSticky();
		this.positionWidgets();
	};
	private appendText(element: HTMLElement, row: VisualRow): void {
		const text = this.model.getLineContent(row.line),
			start = this.model.getInputOffsetAt({ line: row.line, column: 1 });
		const boundaries = new Set<number>([row.from, row.to]);
		const marks: {
			from: number;
			to: number;
			className?: string;
			background?: string;
			underline?: string;
			title?: string;
		}[] = [];
		const mark = (
			from: number,
			to: number,
			options: Omit<(typeof marks)[number], "from" | "to">,
		) => {
			from = Math.max(row.from, from);
			to = Math.min(row.to, to);
			if (to < from) return;
			marks.push({ from, to, ...options });
			boundaries.add(from);
			boundaries.add(to);
		};
		let low = 0,
			high = this.tokens.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if ((this.tokens[mid]?.to ?? 0) < start + row.from) low = mid + 1;
			else high = mid;
		}
		for (let index = low; index < this.tokens.length; index++) {
			const token = this.tokens[index];
			if (!token || token.from > start + row.to) break;
			if (/^[a-z0-9-]+$/.test(token.kind))
				mark(token.from - start, token.to - start, {
					className: `editor-token-${token.kind}`,
				});
		}
		for (let index = 0; index < this.search.length; index++) {
			const match = this.search[index];
			if (
				match &&
				row.line >= match.range.startLine &&
				row.line <= match.range.endLine
			)
				mark(
					row.line === match.range.startLine
						? match.range.startColumn - 1
						: 0,
					row.line === match.range.endLine
						? match.range.endColumn - 1
						: text.length,
					{
						className: `editor-find-match${index === this.currentMatch ? " editor-find-match-current" : ""}`,
					},
				);
		}
		for (const position of this.brackets)
			if (position.line === row.line)
				mark(position.column - 1, position.column, {
					className: "editor-matching-bracket",
				});
		for (const decoration of this.decorations) {
			const range = decoration.range;
			if (row.line >= range.startLine && row.line <= range.endLine)
				mark(
					row.line === range.startLine ? range.startColumn - 1 : 0,
					row.line === range.endLine
						? range.endColumn - 1
						: text.length,
					{
						...(decoration.className
							? { className: decoration.className }
							: {}),
						...(decoration.background
							? { background: decoration.background }
							: {}),
						...(decoration.underline
							? { underline: decoration.underline }
							: {}),
						...(decoration.hover
							? { title: decoration.hover }
							: {}),
					},
				);
		}
		if (this.options.renderWhitespace === "all")
			for (let column = row.from; column < row.to; column++)
				if (/[\t ]/.test(text[column] ?? "")) {
					boundaries.add(column);
					boundaries.add(column + 1);
				}
		const hints =
			this.options.inlayHints &&
			!this.accessible &&
			this.assistanceVersion === this.model.getVersionId()
				? this.hints.filter(
						(hint) =>
							hint.offset >= start + row.from &&
							hint.offset <= start + row.to,
					)
				: [];
		for (const hint of hints) boundaries.add(hint.offset - start);
		const appendHints = (column: number) => {
			for (const hint of hints.filter(
				(hint) => hint.offset - start === column,
			)) {
				const node = element.ownerDocument.createElement("span");
				node.className = "editor-inlay-hint";
				node.textContent = hint.text;
				node.title = hint.tooltip ?? hint.text;
				element.append(node);
			}
		};
		const sorted = [...boundaries].sort((a, b) => a - b);
		for (let i = 0; i < sorted.length - 1; i++) {
			const from = sorted[i] ?? 0,
				to = sorted[i + 1] ?? 0,
				active = marks.filter(
					(mark) => mark.from < to && mark.to > from,
				);
			appendHints(from);
			const span = element.ownerDocument.createElement("span");
			span.textContent = text.slice(from, to);
			span.className = active
				.map((mark) => mark.className ?? "")
				.join(" ");
			for (const item of active) {
				if (item.background) span.style.background = item.background;
				if (item.underline) {
					span.style.textDecorationLine = "underline";
					span.style.textDecorationStyle = "wavy";
					span.style.textDecorationColor = item.underline;
				}
				if (item.title) span.title = item.title;
			}
			if (
				this.options.renderWhitespace === "all" &&
				/^[\t ]$/.test(span.textContent)
			) {
				span.classList.add("editor-visible-whitespace");
				span.dataset.whitespace = span.textContent === "\t" ? "→" : "·";
			}
			element.append(span);
		}
		if (row.to === text.length) appendHints(row.to);
		if (!text.length)
			element.append(element.ownerDocument.createTextNode(""));
		if (
			this.folds.some(
				(fold) => fold.start === row.line && fold.collapsed,
			) &&
			row.to === text.length
		) {
			const placeholder = element.ownerDocument.createElement("span");
			placeholder.className = "editor-fold-placeholder";
			placeholder.dataset.fold = String(row.line);
			placeholder.setAttribute("aria-label", "Folded lines");
			element.append(placeholder);
		}
	}
	private paintSelections(): void {
		if (this.paintedVersion !== this.model.getVersionId()) {
			this.render();
			return;
		}
		const fragment = this.root.ownerDocument.createDocumentFragment();
		const rectangle = (
			name: string,
			x: number,
			y: number,
			width: number,
			height: number,
		) => {
			const node = this.root.ownerDocument.createElement("div");
			node.className = name;
			node.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
			fragment.append(node);
		};
		const lines = new Set(this.visible.map((row) => row.line));
		for (const selection of this.accessible
			? this.selections.slice(1)
			: this.selections) {
			const start = this.model.getPositionAtInputOffset(selection.start),
				end = this.model.getPositionAtInputOffset(selection.end);
			if (selection.start !== selection.end)
				for (const line of lines) {
					if (line < start.line || line > end.line) continue;
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
			const active = selection.direction === "backward" ? start : end,
				visual = this.layout.position(
					active.line,
					active.column,
					selection.affinity,
				);
			if (this.visible.some((row) => row.index === visual.index)) {
				const point = this.geometry.point(active, selection.affinity);
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
		if (this.options.indentGuides)
			for (const row of this.visible) {
				if (row.from) continue;
				const text = this.model.getLineContent(row.line),
					leading = text.match(/^[\t ]*/)?.[0] ?? "",
					width = this.geometry.measure(leading),
					tab = this.columnWidth * this.options.tabSize;
				for (let x = tab; x < width; x += tab)
					rectangle(
						"editor-indent-guide",
						this.padding + x,
						this.padding +
							row.index * this.lineHeight -
							(this.accessible ? this.viewport.scrollTop : 0),
						1,
						this.lineHeight,
					);
			}
		this.selectionLayer.replaceChildren(fragment);
		const rulerFragment = this.root.ownerDocument.createDocumentFragment();
		for (const column of this.options.rulers) {
			const ruler = this.root.ownerDocument.createElement("div");
			ruler.className = "editor-ruler";
			ruler.style.left = `${this.padding + column * this.columnWidth}px`;
			rulerFragment.append(ruler);
		}
		this.rulerLayer.replaceChildren(rulerFragment);
		if (this.input && !this.accessible && this.selections[0]) {
			const selection = this.selections[0],
				point = this.point(
					this.model.getPositionAtInputOffset(
						selection.direction === "backward"
							? selection.start
							: selection.end,
					),
					selection.affinity,
				);
			this.input.style.left = `${Math.max(this.viewport.scrollLeft, Math.min(point.x, this.viewport.scrollLeft + this.viewport.clientWidth - 4))}px`;
			this.input.style.top = `${Math.max(this.viewport.scrollTop, Math.min(point.y, this.viewport.scrollTop + this.viewport.clientHeight - this.lineHeight))}px`;
			this.input.style.height = `${this.lineHeight}px`;
		}
	}
	private paintOverview(): void {
		const height = this.viewport.clientHeight,
			fragment = this.root.ownerDocument.createDocumentFragment();
		this.overview.style.height = `${height}px`;
		for (const decoration of this.decorations) {
			if (!decoration.overview) continue;
			const node = this.root.ownerDocument.createElement("button");
			node.type = "button";
			node.className = "editor-overview-marker";
			node.title = decoration.hover ?? "Decoration";
			node.style.cssText = `top:${(this.layout.position(decoration.range.startLine, 1).index / Math.max(1, this.layout.rowCount)) * height}px;background:${decoration.overview}`;
			node.onclick = () =>
				this.callbacks.onSelectLine?.(decoration.range.startLine);
			fragment.append(node);
		}
		this.overview.replaceChildren(fragment);
		if (!this.options.minimap) return;
		const scale = devicePixelRatio || 1,
			width = 80;
		this.minimap.width = width * scale;
		this.minimap.height = Math.max(1, height * scale);
		this.minimap.style.height = `${height}px`;
		const context = this.minimap.getContext("2d");
		if (!context) return;
		context.scale(scale, scale);
		const style = getComputedStyle(this.root),
			foreground = style.getPropertyValue("--editor-foreground");
		context.fillStyle = foreground;
		context.globalAlpha = 0.45;
		const count = Math.min(2000, this.layout.rowCount);
		for (let index = 0; index < count; index++) {
			const row = this.layout.row(
					Math.floor((index / count) * this.layout.rowCount),
				),
				text = this.model
					.getLineContent(row.line)
					.slice(row.from, Math.min(row.to, row.from + 120));
			for (const match of text.matchAll(/\S+/g))
				context.fillRect(
					3 + match.index * 0.6,
					(index / count) * height,
					Math.min(74 - match.index * 0.6, match[0].length * 0.6),
					Math.max(1, height / count),
				);
		}
		context.globalAlpha = 0.18;
		context.fillStyle = style.getPropertyValue("--editor-accent");
		const total = this.layout.rowCount * this.lineHeight;
		context.fillRect(
			0,
			(this.viewport.scrollTop / total) * height,
			width,
			Math.max(6, (height / total) * height),
		);
	}
	private paintSticky(): void {
		const first =
			this.visible.find(
				(row) =>
					this.padding + row.index * this.lineHeight >=
					this.viewport.scrollTop,
			)?.line ?? 1;
		const ancestors =
			this.options.stickyScroll && !this.accessible
				? this.folds
						.filter(
							(fold) => fold.start < first && fold.end >= first,
						)
						.slice(-3)
				: [];
		const fragment = this.root.ownerDocument.createDocumentFragment();
		for (const fold of ancestors) {
			const button = this.root.ownerDocument.createElement("button");
			button.type = "button";
			button.textContent = this.model.getLineContent(fold.start);
			button.onclick = () => this.callbacks.onSelectLine?.(fold.start);
			fragment.append(button);
		}
		this.sticky.replaceChildren(fragment);
		this.sticky.style.left = `${this.viewport.scrollLeft}px`;
		this.sticky.style.top = `${this.viewport.scrollTop}px`;
	}
	private readonly mapClick = (event: PointerEvent): void => {
		const rect = this.minimap.getBoundingClientRect();
		this.viewport.scrollTop =
			((event.clientY - rect.top) / Math.max(1, rect.height)) *
				this.layout.rowCount *
				this.lineHeight -
			this.viewport.clientHeight / 2;
		this.render();
	};
	private readonly mapKey = (event: KeyboardEvent): void => {
		if (
			["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)
		) {
			event.preventDefault();
			this.viewport.scrollTop +=
				(event.key.includes("Up") ? -1 : 1) *
				(event.key.startsWith("Page")
					? this.viewport.clientHeight
					: this.lineHeight);
			this.render();
		}
	};
	addWidget(
		id: string,
		node: HTMLElement,
		position: () => Position,
		placement: "above" | "below" | "inline" = "below",
	): Disposable {
		if (this.widgets.has(id))
			throw new Error(`Widget already registered: ${id}`);
		node.dataset.editorWidget = id;
		node.classList.add("editor-content-widget");
		this.surface.append(node);
		this.widgets.set(id, { node, position, placement, model: this.model });
		this.positionWidgets();
		return {
			dispose: () => {
				if (this.widgets.get(id)?.node === node)
					this.widgets.delete(id);
				node.remove();
			},
		};
	}
	private positionWidgets(): void {
		for (const widget of this.widgets.values()) {
			const position = widget.position(),
				row = this.layout.position(position.line, position.column);
			widget.node.hidden =
				widget.model !== this.model ||
				!this.visible.some((value) => value.index === row.index);
			if (widget.node.hidden) continue;
			const point = this.geometry.point(position);
			widget.node.style.left = `${point.x + (widget.placement === "inline" ? -11 : 0)}px`;
			widget.node.style.top = `${point.y + (widget.placement === "above" ? -widget.node.offsetHeight : widget.placement === "below" ? this.lineHeight : 5)}px`;
		}
	}

	setDropOffset(offset: number | undefined): void {
		if (offset === this.dropOffset) return;
		this.dropOffset = offset;
		this.paintSelections();
	}
	setSelections(values: readonly TextSelection[]): void {
		this.selections = values.map((value) => ({ ...value }));
		this.paintSelections();
	}
	setBracketMatches(values: readonly Position[]): void {
		if (JSON.stringify(values) === JSON.stringify(this.brackets)) return;
		this.brackets = values;
		this.revision++;
		this.render();
	}
	setSearchMatches(values: readonly SearchMatch[], current: number): void {
		this.search = values;
		this.currentMatch = current;
		this.revision++;
		this.render();
	}
	setActiveLine(line: number): void {
		if (this.activeLine === line) return;
		this.activeLine = line;
		for (const row of this.rows.children)
			row.classList.toggle(
				"editor-active-visual-line",
				Number((row as HTMLElement).dataset.line) === line,
			);
	}
	setTabSize(size: number): void {
		this.configure({ ...this.options, tabSize: size });
	}
	setModel(model: TextModel): void {
		this.subscription?.dispose();
		this.modelValue = model;
		this.geometry.resetMeasurements();
		this.layout.invalidate();
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.tokens = [];
		this.decorations = [];
		this.search = [];
		this.hints = [];
		this.lenses = [];
		this.brackets = [];
		this.selections = [];
		this.folds = [];
		this.rowsKey = "";
		this.widest = 0;
		this.render();
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.root.ownerDocument.fonts?.removeEventListener(
			"loadingdone",
			this.fontsChanged,
		);
		this.scroller.removeEventListener("scroll", this.render);
		this.input?.removeEventListener("scroll", this.inputScroll);
		this.minimap.removeEventListener("pointerdown", this.mapClick);
		this.minimap.removeEventListener("keydown", this.mapKey);
		this.subscription?.dispose();
		this.geometry.clear();
		this.rows.replaceChildren();
		this.gutter.dispose();
		for (const widget of this.widgets.values()) widget.node.remove();
		this.widgets.clear();
		this.root.remove();
		this.modelValue = undefined;
		this.tokens = [];
		this.decorations = [];
		this.selections = [];
		this.hints = [];
		this.lenses = [];
	}
}
