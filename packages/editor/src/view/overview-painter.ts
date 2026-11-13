import type { EditorOptions } from "../api/editor-options";
import type { VisibleDecoration } from "../features/decorations";
import type { TextModel } from "../model/text-model";
import { performanceLimits } from "../performance/limits";
import type { FoldRegion, VisualLayout, VisualRow } from "./visual-layout";

interface paintOverviewState {
	readonly scrollTop: number;
	readonly viewport: HTMLElement;
	readonly root: HTMLElement;
	readonly overview: HTMLElement;
	readonly decorations: readonly VisibleDecoration[];
	readonly layout: VisualLayout;
	readonly callbacks: { onSelectLine?: (line: number) => void };
	readonly options: EditorOptions;
	readonly minimap: HTMLCanvasElement;
	readonly model: TextModel;
	readonly lineHeight: number;
}
export class OverviewPainter {
	private key = "";
	private mapKey = "";
	private decorations: readonly VisibleDecoration[] = [];
	private base: HTMLCanvasElement | undefined;
	paint(state: paintOverviewState): void {
		const height = state.viewport.clientHeight,
			scale = devicePixelRatio || 1,
			width = 80,
			key = `${state.model.id}:${state.model.getVersionId()}:${state.layout.revision}:${height}:${scale}:${state.options.theme}`;
		if (key !== this.key || this.decorations !== state.decorations) {
			this.key = key;
			this.decorations = state.decorations;
			state.overview.style.height = `${height}px`;
			const slots = Math.max(
					1,
					Math.min(
						Math.ceil(height),
						performanceLimits.overviewMarkers,
					),
				),
				buckets = new Map<
					number,
					{ decoration: VisibleDecoration; count: number }
				>();
			for (const decoration of state.decorations) {
				if (!decoration.overview) continue;
				const top =
						state.layout.rowTop(
							state.layout.position(decoration.range.startLine, 1)
								.index,
						) / Math.max(1, state.layout.height),
					slot = Math.min(
						slots - 1,
						Math.max(0, Math.floor(top * slots)),
					);
				const old = buckets.get(slot);
				buckets.set(slot, { decoration, count: (old?.count ?? 0) + 1 });
			}
			const fragment = state.root.ownerDocument.createDocumentFragment();
			for (const [slot, { decoration, count }] of buckets) {
				const node = state.root.ownerDocument.createElement("button");
				node.type = "button";
				node.tabIndex = fragment.childNodes.length ? -1 : 0;
				node.onkeydown = (event) => {
					if (
						event.ctrlKey ||
						event.altKey ||
						event.metaKey ||
						event.isComposing
					)
						return;
					const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
					if (!keys.includes(event.key)) return;
					event.preventDefault();
					const buttons = [
						...state.overview.querySelectorAll<HTMLButtonElement>(
							"button",
						),
					];
					const index = buttons.indexOf(node);
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? buttons.length - 1
								: (index +
										(event.key === "ArrowDown" ? 1 : -1) +
										buttons.length) %
									buttons.length;
					for (const [index, button] of buttons.entries())
						button.tabIndex = index === next ? 0 : -1;
					buttons[next]?.focus({ preventScroll: true });
				};
				node.className = "editor-overview-marker";
				node.title = `${decoration.hover ?? "Decoration"}${count > 1 ? ` (${count} markers in this row)` : ""}`;
				node.style.cssText = `top:${(slot / slots) * height}px;background:${decoration.overview}`;
				node.onclick = () =>
					state.callbacks.onSelectLine?.(decoration.range.startLine);
				fragment.append(node);
			}
			state.overview.replaceChildren(fragment);
		}
		if (!state.options.minimap) {
			if (this.base) {
				this.base.width = 0;
				this.base = undefined;
				this.mapKey = "";
			}
			return;
		}
		if (!this.base)
			this.base = state.root.ownerDocument.createElement("canvas");
		if (this.mapKey !== key) {
			this.mapKey = key;
			this.base.width = width * scale;
			this.base.height = Math.max(1, height * scale);
			const context = this.base.getContext("2d");
			if (!context) return;
			context.scale(scale, scale);
			context.fillStyle = getComputedStyle(state.root).getPropertyValue(
				"--editor-foreground",
			);
			context.globalAlpha = 0.45;
			const count = Math.min(2000, state.layout.rowCount);
			for (let index = 0; index < count; index++) {
				const row = state.layout.rowAtHeight(
						(index / count) * state.layout.height,
					),
					text = state.model
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
		}
		if (state.minimap.width !== width * scale)
			state.minimap.width = width * scale;
		if (state.minimap.height !== Math.max(1, height * scale))
			state.minimap.height = Math.max(1, height * scale);
		state.minimap.style.height = `${height}px`;
		const context = state.minimap.getContext("2d");
		if (!context) return;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, state.minimap.width, state.minimap.height);
		context.drawImage(this.base, 0, 0);
		context.scale(scale, scale);
		context.globalAlpha = 0.18;
		context.fillStyle = getComputedStyle(state.root).getPropertyValue(
			"--editor-accent",
		);
		const total = Math.max(1, state.layout.height);
		context.fillRect(
			0,
			(state.scrollTop / total) * height,
			width,
			Math.max(6, (height / total) * height),
		);
		context.globalAlpha = 1;
	}
	dispose(): void {
		if (this.base) this.base.width = 0;
		this.base = undefined;
		this.decorations = [];
		this.key = "";
		this.mapKey = "";
	}
}

interface paintStickyHeadersState {
	readonly scrollTop: number;
	readonly visible: readonly VisualRow[];
	readonly padding: number;
	readonly lineHeight: number;
	readonly viewport: HTMLElement;
	readonly options: EditorOptions;
	readonly accessible: boolean;
	readonly folds: readonly FoldRegion[];
	readonly root: HTMLElement;
	readonly model: TextModel;
	readonly callbacks: { onSelectLine?: (line: number) => void };
	readonly sticky: HTMLElement;
	readonly layout: VisualLayout;
}
export function paintStickyHeaders(state: paintStickyHeadersState): void {
	const first =
		state.visible.find(
			(row) =>
				state.padding + state.layout.rowTop(row.index) >=
				state.scrollTop,
		)?.line ?? 1;
	const ancestors =
		state.options.stickyScroll && !state.accessible
			? state.folds
					.filter((fold) => fold.start < first && fold.end >= first)
					.slice(-3)
			: [];
	const fragment = state.root.ownerDocument.createDocumentFragment();
	for (const fold of ancestors) {
		const button = state.root.ownerDocument.createElement("button");
		button.type = "button";
		button.textContent = state.model
			.getLineContent(fold.start)
			.slice(0, 2000);
		button.onclick = () => state.callbacks.onSelectLine?.(fold.start);
		fragment.append(button);
	}
	state.sticky.replaceChildren(fragment);
	state.sticky.style.left = `${state.viewport.scrollLeft}px`;
	state.sticky.style.top = `${state.viewport.scrollTop}px`;
}
