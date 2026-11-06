import { defaultViewOptions, type EditorOptions } from "../api/editor-options";
import type { InlayHint, Token } from "../api/languages";
import type { Disposable, Position, TextSelection } from "../api/types";
import type { SyntaxPalette } from "../features/clipboard-payload";
import type { VisibleDecoration } from "../features/decorations";
import type { SearchMatch } from "../features/search";
import {
	applyTheme,
	isTokenScope,
	resolveThemeName,
	resolveTokenStyle,
	tokenStyleText,
} from "../features/themes";
import { mergeTokenLayers, validateTokens } from "../languages/token-spans";
import type { TextModel } from "../model/text-model";
import "../styles/editor.css";
import type { BracketGuide } from "./bracket-guides";
import { LineNumberGutter } from "./line-number-gutter";
import { paintOverview, paintStickyHeaders } from "./overview-painter";
import { PlatformMedia } from "./platform-media";
import { appendRow } from "./row-painter";
import { ScrollAxis } from "./scroll-axis";
import { paintSelectionLayers } from "./selection-painter";
import { TextGeometry } from "./text-geometry";
import { ligatureStyle, snapToDevicePixels } from "./text-shaping";
import {
	type FoldRegion,
	type LayoutZone,
	VisualLayout,
	type VisualRow,
} from "./visual-layout";
import {
	type ContentWidgetOptions,
	type OverlayWidgetOptions,
	type WidgetFocusPolicy,
	WidgetLayer,
} from "./widget-layer";

interface TextRendererOptions {
	readonly input?: HTMLTextAreaElement;
	readonly padding?: number;
	readonly height?: string;
	readonly onSelectLine?: (line: number) => void;
	readonly onFocusEditor?: () => void;
	readonly onFontZoom?: (level: number) => void;
}
export const minFontZoom = -5;
export const maxFontZoom = 9;
export interface ScrollAnchor {
	readonly line: number;
	readonly column: number;
	readonly offset: number;
	readonly left: number;
	readonly rowDelta?: number;
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
	private resizeFrame = 0;
	private subscription: Disposable | undefined;
	private options: EditorOptions = {
		...defaultViewOptions,
		tabSize: 4,
		insertSpaces: false,
		readOnly: false,
		tabFocusMode: false,
		accessibilitySupport: "auto",
	};
	private requestedOptions: EditorOptions = this.options;
	private fontZoom = 0;
	private wheelZoom = 0;
	private readonly media: PlatformMedia;
	private readonly widgetLayer: WidgetLayer;
	private accessible = false;
	private disposed = false;
	private readonly padding: number;
	private activeLine = 1;
	private selections: readonly TextSelection[] = [];
	private folds: readonly FoldRegion[] = [];
	private tokens: readonly Token[] = [];
	private lexicalTokens: readonly Token[] = [];
	private semanticTokens: readonly Token[] = [];
	private tokenVersion = -1;
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
	private bracketGuides: readonly BracketGuide[] = [];
	private rowsKey = "";
	private revision = 0;
	private visible: VisualRow[] = [];
	private widest = 0;
	private readonly verticalScroll = new ScrollAxis();
	private readonly horizontalScroll = new ScrollAxis();
	get scrollLeft(): number {
		return this.accessible
			? this.viewport.scrollLeft
			: this.horizontalScroll.read(this.scroller.scrollLeft);
	}
	set scrollLeft(value: number) {
		if (this.accessible) this.viewport.scrollLeft = value;
		else
			this.horizontalScroll.write(value, (native) => {
				this.scroller.scrollLeft = native;
				return this.scroller.scrollLeft;
			});
	}
	private get horizontalOrigin(): number {
		return this.accessible ? 0 : this.scrollLeft - this.scroller.scrollLeft;
	}
	get scrollTop(): number {
		return this.accessible
			? this.viewport.scrollTop
			: this.verticalScroll.read(this.scroller.scrollTop);
	}
	set scrollTop(value: number) {
		if (this.accessible) this.viewport.scrollTop = value;
		else
			this.verticalScroll.write(value, (native) => {
				this.scroller.scrollTop = native;
				return this.scroller.scrollTop;
			});
	}
	private get scrollOrigin(): number {
		return this.accessible ? 0 : this.scrollTop - this.scroller.scrollTop;
	}
	private dropOffset: number | undefined;
	private paintedVersion = -1;
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
		this.root.dir = "ltr";
		container.append(this.root);
		this.widgetLayer = new WidgetLayer(
			this.surface,
			this.scroller,
			() => this.callbacks.onFocusEditor?.(),
			() => {
				this.revision++;
				this.render();
			},
			() => {
				if (!this.disposed) this.positionWidgets();
			},
		);
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
		this.scroller.addEventListener("wheel", this.wheel, { passive: false });
		this.input?.addEventListener("scroll", this.inputScroll);
		this.minimap.addEventListener("pointerdown", this.mapClick);
		this.minimap.addEventListener("keydown", this.mapKey);
		this.subscription = this.input
			? undefined
			: model.onDidChangeContent(this.render);
		this.resizeObserver = new ResizeObserver(() => {
			if (this.disposed || this.resizeFrame) return;
			const anchor = this.captureAnchor();
			this.resizeFrame = requestAnimationFrame(() => {
				this.resizeFrame = 0;
				if (this.disposed) return;
				this.render();
				this.restoreAnchor(anchor);
			});
		});
		this.resizeObserver.observe(this.scroller);
		this.root.ownerDocument.fonts?.addEventListener(
			"loadingdone",
			this.fontsChanged,
		);
		this.media = new PlatformMedia(doc.defaultView, (kind) => {
			if (this.disposed) return;
			if (kind === "resolution" || this.requestedOptions.theme === "auto")
				this.configure(this.requestedOptions);
		});
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
	private readonly wheel = (event: WheelEvent): void => {
		if (
			this.options.mouseWheelZoom &&
			(event.ctrlKey || event.metaKey) &&
			event.deltaY
		) {
			event.preventDefault();
			this.wheelZoom +=
				event.deltaY *
				(event.deltaMode === 1 ? 33 : event.deltaMode ? 400 : 1);
			if (Math.abs(this.wheelZoom) >= 50) {
				const step = this.wheelZoom < 0 ? 1 : -1;
				this.wheelZoom = 0;
				if (this.setFontZoom(this.fontZoom + step))
					this.callbacks.onFontZoom?.(this.fontZoom);
			}
			return;
		}
		if (
			(!this.verticalScroll.compressed &&
				!this.horizontalScroll.compressed) ||
			this.accessible ||
			event.ctrlKey
		)
			return;
		event.preventDefault();
		const unit =
			event.deltaMode === 1
				? this.lineHeight
				: event.deltaMode === 2
					? this.viewport.clientHeight
					: 1;
		this.scrollTop +=
			(event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
		this.scrollLeft +=
			(event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) *
			unit;
		this.render();
	};
	private readonly inputScroll = (): void => {
		if (this.accessible) this.render();
	};
	get fontZoomLevel(): number {
		return this.fontZoom;
	}
	setFontZoom(level: number): boolean {
		if (!Number.isInteger(level))
			throw new TypeError("Font zoom level must be an integer.");
		const next = Math.max(minFontZoom, Math.min(maxFontZoom, level));
		if (next === this.fontZoom) return false;
		this.fontZoom = next;
		this.configure(this.requestedOptions);
		return true;
	}
	private effectiveOptions(options: EditorOptions): EditorOptions {
		const factor = 1 + this.fontZoom / 10;
		return {
			...options,
			fontSize: Math.round(options.fontSize * factor * 2) / 2,
			lineHeight: snapToDevicePixels(
				Math.round(options.lineHeight * factor),
				this.media?.devicePixelRatio ?? 1,
			),
			theme: resolveThemeName(
				options.theme,
				this.root.ownerDocument.defaultView,
			),
		};
	}
	get resolvedTheme(): string {
		return this.options.theme;
	}
	configure(requested: EditorOptions): void {
		const anchor = this.captureAnchor();
		this.requestedOptions = requested;
		const options = this.effectiveOptions(requested);
		this.options = options;
		const ligatures = ligatureStyle(options.fontLigatures);
		this.root.style.fontVariantLigatures = ligatures.variant;
		this.root.style.fontFeatureSettings = ligatures.features;
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
		if (frame) frame.dataset.themeSetting = requested.theme;
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
				left: this.viewport ? this.scrollLeft : 0,
			};
		const row = this.layout.rowAtHeight(
			Math.max(0, this.scrollTop - this.padding),
		);
		const delta =
			row.kind === "zone"
				? row.index - this.layout.position(row.line, row.from + 1).index
				: 0;
		return {
			line: row.line,
			column: row.from + 1,
			...(delta ? { rowDelta: delta } : {}),
			offset:
				this.scrollTop - (this.padding + this.layout.rowTop(row.index)),
			left: this.scrollLeft,
		};
	}
	restoreAnchor(anchor: ScrollAnchor): void {
		if (this.disposed) return;
		let index = this.layout.position(anchor.line, anchor.column).index;
		if (anchor.rowDelta) {
			const shifted = this.layout.row(index + anchor.rowDelta);
			if (shifted.kind === "zone" && shifted.line === anchor.line)
				index = shifted.index;
		}
		this.scrollTop = Math.max(
			0,
			this.padding + this.layout.rowTop(index) + anchor.offset,
		);
		this.scrollLeft = anchor.left;
		this.render();
	}
	lineTop(line: number): number {
		return (
			this.padding +
			this.layout.rowTop(this.layout.position(line, 1).index)
		);
	}
	lineAtScrollOffset(top: number): number {
		return this.layout.rowAtHeight(Math.max(0, top - this.padding)).line;
	}
	setFolds(folds: readonly FoldRegion[]): void {
		this.folds = folds;
		this.render();
	}
	setTokens(tokens: readonly Token[]): void {
		if (this.tokenVersion !== this.model.getVersionId())
			this.semanticTokens = [];
		this.lexicalTokens = validateTokens(
			tokens,
			this.model.getValueLength({ eol: "\n" }),
		);
		this.tokenVersion = this.model.getVersionId();
		this.tokens = mergeTokenLayers(this.lexicalTokens, this.semanticTokens);
		this.revision++;
		this.render();
	}
	setTokenLayers(
		lexical: readonly Token[],
		semantic: readonly Token[],
	): void {
		const length = this.model.getValueLength({ eol: "\n" });
		const tokens = validateTokens(lexical, length),
			overlays = validateTokens(semantic, length);
		this.lexicalTokens = tokens;
		this.semanticTokens = overlays;
		this.tokens = mergeTokenLayers(tokens, overlays);
		this.tokenVersion = this.model.getVersionId();
		this.revision++;
		this.render();
	}
	setSemanticTokens(tokens: readonly Token[]): void {
		if (this.tokenVersion !== this.model.getVersionId())
			this.lexicalTokens = [];
		this.semanticTokens = validateTokens(
			tokens,
			this.model.getValueLength({ eol: "\n" }),
		);
		this.tokenVersion = this.model.getVersionId();
		this.tokens = mergeTokenLayers(this.lexicalTokens, this.semanticTokens);
		this.revision++;
		this.render();
	}
	syntaxPalette(): SyntaxPalette {
		const view = this.root.ownerDocument.defaultView,
			style = view?.getComputedStyle(this.root);
		const foreground =
			style?.getPropertyValue("--editor-foreground").trim() ||
			style?.color ||
			"";
		const probe = this.root.ownerDocument.createElement("span");
		this.root.append(probe);
		const colors = new Map<string, string>();
		for (const { kind } of this.tokens)
			if (!colors.has(kind) && isTokenScope(kind)) {
				probe.className = `editor-token-${kind.split(".", 1)[0]}`;
				probe.style.cssText = this.tokenStyle(kind) ?? "";
				colors.set(kind, view?.getComputedStyle(probe).color ?? "");
			}
		probe.className = "";
		probe.style.cssText = "";
		const plain = view?.getComputedStyle(probe).color;
		probe.remove();
		return {
			tokens: this.tokens,
			background:
				style?.getPropertyValue("--editor-background").trim() ||
				style?.backgroundColor ||
				"",
			foreground,
			color: (kind) => {
				const color = colors.get(kind);
				return color && color !== plain ? color : undefined;
			},
		};
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
		return this.geometry.hitTest(x, y, this.scrollTop, this.scrollLeft);
	}
	point(
		position: Position,
		affinity: "before" | "after" = "after",
	): { x: number; y: number; height: number } {
		const point = this.geometry.point(position, affinity),
			relative = this.accessible && this.geometry.hasLine(position.line);
		return {
			...point,
			x:
				point.x +
				this.horizontalOrigin +
				(relative ? this.viewport.scrollLeft : 0),
			y:
				point.y +
				this.scrollOrigin +
				(relative ? this.viewport.scrollTop : 0),
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
		const step = rows < 0 ? -1 : 1;
		while (row.kind === "zone") {
			const next = this.layout.row(row.index + step);
			if (next.index === row.index) {
				row = current;
				break;
			}
			row = next;
		}
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
		if (this.tokenVersion !== this.model.getVersionId()) {
			this.semanticTokens = [];
			this.lexicalTokens = [];
			this.tokens = [];
			this.tokenVersion = this.model.getVersionId();
			this.revision++;
		}
		const source = this.viewport,
			width = Math.max(32, source.clientWidth - 2 * this.padding);
		const changed = this.layout.update(
			this.options,
			width,
			this.folds,
			this.accessible,
			this.layoutZones(),
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
		const top = this.scrollTop;
		this.verticalScroll.configure(
			this.layout.height + 2 * this.padding,
			source.clientHeight,
		);
		this.surface.style.height = `${this.accessible ? source.clientHeight : this.verticalScroll.extent}px`;
		this.scrollTop = top;
		const scrollTop = this.scrollTop;
		this.geometry.originY = this.scrollOrigin;
		const first = Math.max(
				0,
				this.layout.rowAtHeight(scrollTop - this.padding).index - 4,
			),
			last = Math.min(
				this.layout.rowCount - 1,
				this.layout.rowAtHeight(
					scrollTop + source.clientHeight - this.padding,
				).index + 5,
			);
		this.visible = [];
		for (let index = first; index <= last; index++)
			this.visible.push(this.layout.row(index));
		const left = this.scrollLeft;
		this.widest = Math.max(
			this.widest,
			...this.visible
				.filter((row) => row.kind !== "zone")
				.map((row) => this.padding * 2 + this.geometry.rowWidth(row)),
		);
		this.horizontalScroll.configure(
			Math.max(source.clientWidth, this.widest),
			source.clientWidth,
		);
		this.surface.style.width = `${this.accessible ? source.clientWidth : this.horizontalScroll.extent}px`;
		this.scrollLeft = left;
		this.geometry.originX = this.horizontalOrigin;
		this.rows.style.top = "0";
		this.rows.style.left = "0";
		const key = `${this.model.id}:${this.model.getVersionId()}:${first}:${last}:${this.revision}:${this.scrollLeft}:${this.horizontalOrigin}:${this.scrollOrigin}:${this.accessible ? `${source.scrollTop},${source.scrollLeft}` : ""}`;
		if (key !== this.rowsKey) {
			this.rowsKey = key;
			const fragment = this.root.ownerDocument.createDocumentFragment();
			this.geometry.clear();
			for (const fullRow of this.visible) {
				if (
					fullRow.kind === "zone" &&
					!fullRow.zone?.startsWith("code-lens:")
				)
					continue;
				const row = this.accessible
					? fullRow
					: this.geometry.window(
							fullRow,
							this.scrollLeft,
							source.clientWidth,
						);
				const element = this.root.ownerDocument.createElement("div");
				element.dataset.line = String(row.line);
				element.dataset.from = String(row.from);
				element.className = "editor-visual-row";
				element.style.minWidth = `${Math.max(0, source.clientWidth - 2 * this.padding - row.indent)}px`;
				element.style.cssText = `position:absolute;top:${this.padding + this.layout.rowTop(row.index) - this.scrollOrigin - (this.accessible ? source.scrollTop : 0)}px;left:${this.padding + row.indent - this.horizontalOrigin - (this.accessible ? source.scrollLeft : 0)}px;height:${this.lineHeight}px;line-height:${this.lineHeight}px`;
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
				if (row.from !== fullRow.from) {
					const phase =
						row.indent % (this.columnWidth * this.options.tabSize);
					const spacer =
						this.root.ownerDocument.createElement("span");
					spacer.style.cssText = `display:inline-block;width:${phase}px`;
					element.prepend(spacer);
					element.style.left = `${this.padding + row.indent - phase - this.horizontalOrigin}px`;
				}
				fragment.append(element);
				if (row.kind !== "zone") this.geometry.register(row, element);
			}
			this.rows.replaceChildren(fragment);
		}
		this.widest = Math.max(
			this.widest,
			...this.visible
				.filter((row) => row.kind !== "zone")
				.map((row) => this.padding * 2 + this.geometry.rowWidth(row)),
			...Array.from(
				this.rows.children,
				(element) =>
					(element as HTMLElement).offsetLeft +
					this.horizontalOrigin +
					(element as HTMLElement).offsetWidth +
					this.padding,
			),
		);
		if (!this.accessible) {
			this.horizontalScroll.configure(
				Math.max(source.clientWidth, this.widest),
				source.clientWidth,
			);
			this.surface.style.width = `${this.horizontalScroll.extent}px`;
		}
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
			scrollTop,
			source.clientHeight,
			this.lineHeight,
			this.padding,
			this.model.getLineCount(),
			this.activeLine,
			this.options.lineNumbers,
			this.accessible ? [] : this.folds,
			glyphs,
			(index) => this.layout.rowTop(index),
		);
		this.paintedVersion = this.model.getVersionId();
		this.paintSelections();
		this.paintOverview();
		this.paintSticky();
		this.positionWidgets();
	};
	private positionWidgets(): void {
		const source = this.viewport;
		this.widgetLayer.paint({
			model: this.model,
			visible: this.visible,
			layout: this.layout,
			lineHeight: this.lineHeight,
			padding: this.padding,
			originY: this.scrollOrigin,
			zonesEnabled: !this.accessible,
			view: this.accessible
				? {
						left: 0,
						top: 0,
						width: source.clientWidth,
						height: source.clientHeight,
					}
				: {
						left: this.scroller.scrollLeft,
						top: this.scroller.scrollTop,
						width: this.scroller.clientWidth,
						height: this.scroller.clientHeight,
					},
			point: (position) => this.geometry.point(position),
		});
	}
	private layoutZones(): LayoutZone[] {
		const zones: LayoutZone[] = [];
		if (
			this.options.codeLens &&
			!this.accessible &&
			this.assistanceVersion === this.model.getVersionId()
		)
			for (const line of new Set(this.lenses.map((lens) => lens.line)))
				zones.push({
					id: `code-lens:${line}`,
					line,
					placement: "before",
					rows: 1,
				});
		return zones.concat(
			this.widgetLayer.layoutZones(this.model, !this.accessible),
		);
	}
	private readonly tokenStyle = (scope: string): string | undefined => {
		const style = resolveTokenStyle(this.options.theme, scope);
		return style ? tokenStyleText(style) || undefined : undefined;
	};
	private appendText(element: HTMLElement, row: VisualRow): void {
		appendRow(
			{
				model: this.model,
				tokens: this.tokens,
				selections: this.selections,
				search: this.search,
				currentMatch: this.currentMatch,
				brackets: this.brackets,
				decorations: this.decorations,
				options: this.options,
				accessible: this.accessible,
				assistanceVersion: this.assistanceVersion,
				hints: this.hints,
				folds: this.folds,
				tokenStyle: this.tokenStyle,
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
			bracketGuides: this.bracketGuides,
			root: this.root,
			visible: this.visible,
			accessible: this.accessible,
			selections: this.selections,
			model: this.model,
			geometry: this.geometry,
			originY: this.scrollOrigin,
			originX: this.horizontalOrigin,
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
			scrollTop: this.scrollTop,
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
			scrollTop: this.scrollTop,
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
			layout: this.layout,
		});
	}
	private readonly mapClick = (event: PointerEvent): void => {
		const rect = this.minimap.getBoundingClientRect();
		this.scrollTop =
			((event.clientY - rect.top) / Math.max(1, rect.height)) *
				this.layout.height -
			this.viewport.clientHeight / 2;
		this.render();
	};
	private readonly mapKey = (event: KeyboardEvent): void => {
		if (
			["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)
		) {
			event.preventDefault();
			this.scrollTop +=
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
		options: ContentWidgetOptions = {},
	): Disposable {
		const handle = this.widgetLayer.addContent(
			id,
			node,
			position,
			this.model,
			options,
		);
		this.positionWidgets();
		return handle;
	}
	addOverlayWidget(
		id: string,
		node: HTMLElement,
		options: OverlayWidgetOptions,
	): Disposable {
		return this.widgetLayer.addOverlay(id, node, options);
	}
	addZone(
		id: string,
		node: HTMLElement,
		anchor: () => { line: number; placement: "before" | "after" },
		rows: () => number,
		focus?: WidgetFocusPolicy,
	): { dispose(): void; refresh(): void } {
		return this.widgetLayer.addZone(
			id,
			node,
			anchor,
			this.model,
			rows,
			focus,
		);
	}

	setDropOffset(offset: number | undefined): void {
		if (offset === this.dropOffset) return;
		this.dropOffset = offset;
		this.paintSelections();
	}
	setSelections(values: readonly TextSelection[]): void {
		this.selections = values.map((value) => ({ ...value }));
		if (this.options.renderWhitespace === "selection") {
			this.revision++;
			this.render();
			return;
		}
		this.paintSelections();
	}
	setBracketMatches(values: readonly Position[]): void {
		if (JSON.stringify(values) === JSON.stringify(this.brackets)) return;
		this.brackets = values;
		this.revision++;
		this.render();
	}
	setBracketGuides(values: readonly BracketGuide[]): void {
		this.bracketGuides = values;
		this.paintSelections();
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
		this.configure({ ...this.requestedOptions, tabSize: size });
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
		this.lexicalTokens = [];
		this.semanticTokens = [];
		this.tokenVersion = -1;
		this.decorations = [];
		this.search = [];
		this.hints = [];
		this.lenses = [];
		this.brackets = [];
		this.bracketGuides = [];
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
		cancelAnimationFrame(this.resizeFrame);
		this.root.ownerDocument.fonts?.removeEventListener(
			"loadingdone",
			this.fontsChanged,
		);
		this.scroller.removeEventListener("scroll", this.render);
		this.scroller.removeEventListener("wheel", this.wheel);
		this.input?.removeEventListener("scroll", this.inputScroll);
		this.minimap.removeEventListener("pointerdown", this.mapClick);
		this.minimap.removeEventListener("keydown", this.mapKey);
		this.media.dispose();
		this.subscription?.dispose();
		this.geometry.dispose();
		this.rows.replaceChildren();
		this.gutter.dispose();
		this.widgetLayer.dispose();
		this.root.remove();
		this.modelValue = undefined;
		this.tokens = [];
		this.lexicalTokens = [];
		this.semanticTokens = [];
		this.bracketGuides = [];
		this.decorations = [];
		this.selections = [];
		this.hints = [];
		this.lenses = [];
	}
}
