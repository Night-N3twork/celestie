import { defaultViewOptions, type EditorOptions } from "../api/editor-options";
import type { InlayHint, Token } from "../api/languages";
import type { Disposable, Position, TextSelection } from "../api/types";
import type { VisibleDecoration } from "../features/decorations";
import type { SearchMatch } from "../features/search";
import { applyTheme } from "../features/themes";
import type { TextModel } from "../model/text-model";
import "../styles/editor.css";
import { LineNumberGutter } from "./line-number-gutter";
import { paintOverview, paintStickyHeaders } from "./overview-painter";
import { appendRow } from "./row-painter";
import { paintSelectionLayers } from "./selection-painter";
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
		appendRow(
			{
				model: this.model,
				tokens: this.tokens,
				search: this.search,
				currentMatch: this.currentMatch,
				brackets: this.brackets,
				decorations: this.decorations,
				options: this.options,
				accessible: this.accessible,
				assistanceVersion: this.assistanceVersion,
				hints: this.hints,
				folds: this.folds,
			},
			element,
			row,
		);
	}
	private paintSelections(): void {
		if (this.paintedVersion !== this.model.getVersionId()) {
			this.render();
			return;
		}
		paintSelectionLayers({
			root: this.root,
			visible: this.visible,
			accessible: this.accessible,
			selections: this.selections,
			model: this.model,
			geometry: this.geometry,
			lineHeight: this.lineHeight,
			layout: this.layout,
			dropOffset: this.dropOffset,
			options: this.options,
			columnWidth: this.columnWidth,
			padding: this.padding,
			viewport: this.viewport,
			selectionLayer: this.selectionLayer,
			rulerLayer: this.rulerLayer,
			input: this.input,
			point: (p, affinity) => this.point(p, affinity),
		});
	}
	private paintOverview(): void {
		paintOverview({
			viewport: this.viewport,
			root: this.root,
			overview: this.overview,
			decorations: this.decorations,
			layout: this.layout,
			callbacks: this.callbacks,
			options: this.options,
			minimap: this.minimap,
			model: this.model,
			lineHeight: this.lineHeight,
		});
	}
	private paintSticky(): void {
		paintStickyHeaders({
			visible: this.visible,
			padding: this.padding,
			lineHeight: this.lineHeight,
			viewport: this.viewport,
			options: this.options,
			accessible: this.accessible,
			folds: this.folds,
			root: this.root,
			model: this.model,
			callbacks: this.callbacks,
			sticky: this.sticky,
		});
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
