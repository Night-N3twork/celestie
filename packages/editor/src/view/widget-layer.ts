import type { Disposable, Position } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TextPoint } from "./text-geometry";
import type { LayoutZone, VisualLayout, VisualRow } from "./visual-layout";

export type ContentWidgetPlacement = "above" | "below" | "inline";
export type WidgetFocusPolicy = "none" | "return" | "trap";
export interface ContentWidgetOptions {
	readonly placement?:
		| ContentWidgetPlacement
		| readonly ContentWidgetPlacement[];
	readonly priority?: number;
	readonly allowOverlap?: boolean;
	readonly focus?: WidgetFocusPolicy;
}
export type OverlayWidgetPosition =
	| "top-left"
	| "top-center"
	| "top-right"
	| "bottom-left"
	| "bottom-right";
export interface OverlayWidgetOptions {
	readonly position: OverlayWidgetPosition;
	readonly priority?: number;
	readonly focus?: WidgetFocusPolicy;
}
export interface ViewZoneOptions {
	readonly afterLine: number;
	readonly heightInLines?: number;
	readonly heightInPx?: number;
	readonly node: HTMLElement;
	readonly focus?: WidgetFocusPolicy;
}
export interface ViewZone extends Disposable {
	readonly id: string;
	getAfterLine(): number | undefined;
	setHeight(height: {
		readonly heightInLines?: number;
		readonly heightInPx?: number;
	}): void;
}
interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}
interface ContentEntry {
	readonly node: HTMLElement;
	readonly position: () => Position;
	readonly placements: readonly ContentWidgetPlacement[];
	readonly priority: number;
	readonly allowOverlap: boolean;
	readonly model: TextModel;
	readonly order: number;
}
interface OverlayEntry {
	readonly node: HTMLElement;
	readonly position: OverlayWidgetPosition;
	readonly priority: number;
	readonly order: number;
}
interface ZoneEntry {
	readonly container: HTMLElement;
	readonly anchor: () => { line: number; placement: "before" | "after" };
	readonly model: TextModel;
	readonly rows: () => number;
}
export interface WidgetPaintState {
	readonly model: TextModel;
	readonly visible: readonly VisualRow[];
	readonly layout: VisualLayout;
	readonly lineHeight: number;
	readonly padding: number;
	readonly originY: number;
	readonly zonesEnabled: boolean;
	readonly view: Readonly<Rect>;
	point(position: Position): TextPoint;
}
const gap = 4;
function overlaps(a: Rect, b: Rect): boolean {
	return (
		a.left < b.left + b.width &&
		b.left < a.left + a.width &&
		a.top < b.top + b.height &&
		b.top < a.top + a.height
	);
}
function focusable(node: HTMLElement): HTMLElement[] {
	return Array.from(
		node.querySelectorAll<HTMLElement>(
			'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]',
		),
	).filter((element) => !element.hidden && !element.closest("[hidden]"));
}
export function zoneRows(
	height: { readonly heightInLines?: number; readonly heightInPx?: number },
	lineHeight: number,
): number {
	const { heightInLines, heightInPx } = height;
	if (heightInLines !== undefined && heightInPx !== undefined)
		throw new TypeError("Use either heightInLines or heightInPx.");
	const value =
		heightInPx !== undefined
			? heightInPx / lineHeight
			: (heightInLines ?? 1);
	if (!Number.isFinite(value) || value <= 0 || value > 1000)
		throw new RangeError("View zone height must be positive and finite.");
	return value;
}
export class WidgetLayer implements Disposable {
	private readonly content = new Map<string, ContentEntry>();
	private readonly overlays = new Map<string, OverlayEntry>();
	private readonly zones = new Map<string, ZoneEntry>();
	private readonly focusBindings = new Map<
		string,
		Disposable & { readonly policy: WidgetFocusPolicy }
	>();
	private readonly overlayLayer: HTMLDivElement;
	private readonly zoneLayer: HTMLDivElement;
	private sequence = 0;
	private overlayRects: Rect[] = [];
	constructor(
		private readonly surface: HTMLElement,
		private readonly scroller: HTMLElement,
		private readonly focusEditor: () => void,
		private readonly invalidate: () => void,
		private readonly repaint: () => void,
	) {
		const doc = surface.ownerDocument;
		this.zoneLayer = doc.createElement("div");
		this.zoneLayer.className = "editor-view-zones";
		this.overlayLayer = doc.createElement("div");
		this.overlayLayer.className = "editor-overlay-widgets";
		surface.append(this.zoneLayer);
		scroller.append(this.overlayLayer);
	}
	private claim(id: string): void {
		if (
			!id ||
			this.content.has(id) ||
			this.overlays.has(id) ||
			this.zones.has(id)
		)
			throw new Error(`Widget already registered: ${id}`);
	}
	private bindFocus(
		id: string,
		node: HTMLElement,
		policy: WidgetFocusPolicy,
	): void {
		const focusout = (event: FocusEvent) => {
			if (!node.contains(event.relatedTarget as Node | null))
				queueMicrotask(() => {
					if (node.isConnected) this.repaint();
				});
		};
		node.addEventListener("focusout", focusout);
		const keydown = (event: KeyboardEvent) => {
			if (policy === "none") return;
			if (event.key === "Escape" && !event.defaultPrevented) {
				event.preventDefault();
				event.stopPropagation();
				this.focusEditor();
				return;
			}
			if (policy !== "trap" || event.key !== "Tab") return;
			const items = focusable(node);
			if (!items.length) {
				event.preventDefault();
				return;
			}
			const first = items[0],
				last = items[items.length - 1],
				active = node.ownerDocument.activeElement;
			if (
				event.shiftKey &&
				(active === first || !node.contains(active))
			) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		node.addEventListener("keydown", keydown);
		this.focusBindings.set(id, {
			policy,
			dispose: () => {
				node.removeEventListener("keydown", keydown);
				node.removeEventListener("focusout", focusout);
			},
		});
	}
	private release(id: string, node: HTMLElement): void {
		const focused = node.contains(node.ownerDocument.activeElement),
			binding = this.focusBindings.get(id);
		binding?.dispose();
		this.focusBindings.delete(id);
		node.remove();
		if (focused && binding?.policy !== "none") this.focusEditor();
	}
	addContent(
		id: string,
		node: HTMLElement,
		position: () => Position,
		model: TextModel,
		options: ContentWidgetOptions = {},
	): Disposable {
		this.claim(id);
		const placements =
			typeof options.placement === "string"
				? [options.placement]
				: [...(options.placement ?? ["below"])];
		if (
			!placements.length ||
			!placements.every((value) =>
				["above", "below", "inline"].includes(value),
			) ||
			!["none", "return", "trap", undefined].includes(options.focus)
		)
			throw new TypeError("Invalid content widget options.");
		node.dataset.editorWidget = id;
		node.classList.add("editor-content-widget");
		this.surface.append(node);
		this.content.set(id, {
			node,
			position,
			placements,
			priority: options.priority ?? 0,
			allowOverlap: options.allowOverlap ?? placements[0] === "inline",
			model,
			order: ++this.sequence,
		});
		this.bindFocus(id, node, options.focus ?? "return");
		return {
			dispose: () => {
				if (this.content.get(id)?.node !== node) return;
				this.content.delete(id);
				this.release(id, node);
			},
		};
	}
	addOverlay(
		id: string,
		node: HTMLElement,
		options: OverlayWidgetOptions,
	): Disposable {
		this.claim(id);
		if (
			![
				"top-left",
				"top-center",
				"top-right",
				"bottom-left",
				"bottom-right",
			].includes(options.position) ||
			!["none", "return", "trap", undefined].includes(options.focus)
		)
			throw new TypeError("Invalid overlay widget options.");
		node.dataset.editorWidget = id;
		node.classList.add("editor-overlay-widget");
		this.overlayLayer.append(node);
		this.overlays.set(id, {
			node,
			position: options.position,
			priority: options.priority ?? 0,
			order: ++this.sequence,
		});
		this.bindFocus(id, node, options.focus ?? "return");
		this.invalidate();
		return {
			dispose: () => {
				if (this.overlays.get(id)?.node !== node) return;
				this.overlays.delete(id);
				this.release(id, node);
				this.invalidate();
			},
		};
	}
	addZone(
		id: string,
		node: HTMLElement,
		anchor: () => { line: number; placement: "before" | "after" },
		model: TextModel,
		rows: () => number,
		focus: WidgetFocusPolicy = "return",
	): { dispose(): void; refresh(): void } {
		this.claim(id);
		if (!["none", "return", "trap"].includes(focus))
			throw new TypeError("Invalid view zone focus policy.");
		const container = this.surface.ownerDocument.createElement("div");
		container.className = "editor-view-zone";
		container.dataset.editorWidget = id;
		container.hidden = true;
		container.append(node);
		this.zoneLayer.append(container);
		const entry: ZoneEntry = { container, anchor, model, rows };
		this.zones.set(id, entry);
		this.bindFocus(id, container, focus);
		this.invalidate();
		return {
			refresh: () => {
				if (this.zones.get(id) === entry) this.invalidate();
			},
			dispose: () => {
				if (this.zones.get(id) !== entry) return;
				this.zones.delete(id);
				this.release(id, container);
				this.invalidate();
			},
		};
	}
	layoutZones(model: TextModel, enabled: boolean): LayoutZone[] {
		if (!enabled) return [];
		const result: LayoutZone[] = [];
		for (const [id, zone] of this.zones)
			if (zone.model === model) {
				const anchor = zone.anchor();
				result.push({ id, ...anchor, rows: zone.rows() });
			}
		return result;
	}
	paint(state: WidgetPaintState): void {
		this.paintOverlays();
		this.paintZones(state);
		this.paintContent(state);
	}
	private paintOverlays(): void {
		const scroller = this.scroller,
			width = scroller.clientWidth,
			height = scroller.clientHeight;
		this.overlayLayer.style.cssText = `left:${scroller.scrollLeft}px;top:${scroller.scrollTop}px;width:${width}px;height:${height}px`;
		const stacks = new Map<OverlayWidgetPosition, OverlayEntry[]>();
		for (const entry of this.overlays.values()) {
			const stack = stacks.get(entry.position) ?? [];
			stack.push(entry);
			stacks.set(entry.position, stack);
		}
		this.overlayRects = [];
		for (const [position, stack] of stacks) {
			stack.sort((a, b) => b.priority - a.priority || a.order - b.order);
			let offset = gap;
			for (const { node } of stack) {
				node.hidden = false;
				const nodeWidth = node.offsetWidth,
					nodeHeight = node.offsetHeight,
					left = position.endsWith("left")
						? gap
						: position.endsWith("right")
							? Math.max(gap, width - nodeWidth - gap)
							: Math.max(gap, (width - nodeWidth) / 2),
					top = position.startsWith("top")
						? offset
						: Math.max(gap, height - offset - nodeHeight);
				node.style.left = `${left}px`;
				node.style.top = `${top}px`;
				offset += nodeHeight + gap;
				this.overlayRects.push({
					left: left + scroller.scrollLeft,
					top: top + scroller.scrollTop,
					width: nodeWidth,
					height: nodeHeight,
				});
			}
		}
	}
	private paintZones(state: WidgetPaintState): void {
		const first = state.visible[0]?.index ?? 0,
			last = state.visible[state.visible.length - 1]?.index ?? -1,
			active = this.surface.ownerDocument.activeElement;
		for (const [id, zone] of this.zones) {
			const start =
				zone.model === state.model && state.zonesEnabled
					? state.layout.zoneStart(id)
					: undefined;
			const rows = zone.rows(),
				visible =
					start !== undefined &&
					start <= last &&
					start + Math.ceil(rows) - 1 >= first;
			zone.container.hidden =
				start === undefined ||
				(!visible && !zone.container.contains(active));
			if (zone.container.hidden || start === undefined) continue;
			zone.container.style.top = `${state.padding + state.layout.rowTop(start) - state.originY}px`;
			zone.container.style.left = `${state.view.left}px`;
			zone.container.style.width = `${state.view.width}px`;
			zone.container.style.height = `${rows * state.lineHeight}px`;
		}
	}
	private paintContent(state: WidgetPaintState): void {
		const view = state.view,
			active = this.surface.ownerDocument.activeElement,
			placed: Rect[] = this.overlayRects.map((rect) => ({ ...rect })),
			entries = [...this.content.values()].sort(
				(a, b) => b.priority - a.priority || a.order - b.order,
			);
		for (const entry of entries) {
			const node = entry.node,
				focused = node.contains(active);
			if (entry.model !== state.model) {
				node.hidden = true;
				continue;
			}
			const position = entry.position(),
				row = state.layout.position(position.line, position.column);
			if (
				!focused &&
				!state.visible.some((value) => value.index === row.index)
			) {
				node.hidden = true;
				continue;
			}
			node.hidden = false;
			const point = state.point(position),
				width = node.offsetWidth,
				height = node.offsetHeight;
			if (entry.placements[0] === "inline") {
				node.hidden =
					!focused &&
					(point.x + width < view.left ||
						point.x > view.left + view.width);
				node.style.left = `${point.x - 11}px`;
				node.style.top = `${point.y + 5}px`;
				node.dataset.placement = "inline";
				continue;
			}
			if (
				!focused &&
				(point.x + width < view.left ||
					point.x > view.left + view.width)
			) {
				node.hidden = true;
				continue;
			}
			const left =
				width >= view.width
					? view.left
					: Math.max(
							view.left,
							Math.min(point.x, view.left + view.width - width),
						);
			let chosen:
				| { rect: Rect; placement: ContentWidgetPlacement }
				| undefined;
			let fallback: typeof chosen;
			for (const placement of entry.placements) {
				if (placement === "inline") continue;
				const rect = {
					left,
					top:
						placement === "above"
							? point.y - height
							: point.y + state.lineHeight,
					width,
					height,
				};
				if (!entry.allowOverlap)
					for (let pass = 0; pass <= placed.length; pass++) {
						const blocker = placed.find((other) =>
							overlaps(rect, other),
						);
						if (!blocker) break;
						rect.top =
							placement === "above"
								? blocker.top - height
								: blocker.top + blocker.height;
					}
				fallback ??= { rect, placement };
				if (
					rect.top >= view.top &&
					rect.top + height <= view.top + view.height
				) {
					chosen = { rect, placement };
					break;
				}
			}
			const result = chosen ?? fallback;
			if (!result) continue;
			node.style.left = `${result.rect.left}px`;
			node.style.top = `${result.rect.top}px`;
			node.dataset.placement = result.placement;
			if (!entry.allowOverlap) placed.push(result.rect);
		}
	}
	dispose(): void {
		for (const binding of this.focusBindings.values()) binding.dispose();
		this.focusBindings.clear();
		for (const entry of this.content.values()) entry.node.remove();
		for (const entry of this.overlays.values()) entry.node.remove();
		this.content.clear();
		this.overlays.clear();
		this.zones.clear();
		this.zoneLayer.remove();
		this.overlayLayer.remove();
	}
}
