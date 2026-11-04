import type { EditorOptions } from "../api/editor-options";
import type { VisibleDecoration } from "../features/decorations";
import type { TextModel } from "../model/text-model";
import type { FoldRegion, VisualLayout, VisualRow } from "./visual-layout";

interface paintOverviewState {
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
export function paintOverview(state: paintOverviewState): void {
	const height = state.viewport.clientHeight,
		fragment = state.root.ownerDocument.createDocumentFragment();
	state.overview.style.height = `${height}px`;
	for (const decoration of state.decorations) {
		if (!decoration.overview) continue;
		const node = state.root.ownerDocument.createElement("button");
		node.type = "button";
		node.className = "editor-overview-marker";
		node.title = decoration.hover ?? "Decoration";
		node.style.cssText = `top:${(state.layout.position(decoration.range.startLine, 1).index / Math.max(1, state.layout.rowCount)) * height}px;background:${decoration.overview}`;
		node.onclick = () =>
			state.callbacks.onSelectLine?.(decoration.range.startLine);
		fragment.append(node);
	}
	state.overview.replaceChildren(fragment);
	if (!state.options.minimap) return;
	const scale = devicePixelRatio || 1,
		width = 80;
	state.minimap.width = width * scale;
	state.minimap.height = Math.max(1, height * scale);
	state.minimap.style.height = `${height}px`;
	const context = state.minimap.getContext("2d");
	if (!context) return;
	context.scale(scale, scale);
	const style = getComputedStyle(state.root),
		foreground = style.getPropertyValue("--editor-foreground");
	context.fillStyle = foreground;
	context.globalAlpha = 0.45;
	const count = Math.min(2000, state.layout.rowCount);
	for (let index = 0; index < count; index++) {
		const row = state.layout.row(
				Math.floor((index / count) * state.layout.rowCount),
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
	context.globalAlpha = 0.18;
	context.fillStyle = style.getPropertyValue("--editor-accent");
	const total = state.layout.rowCount * state.lineHeight;
	context.fillRect(
		0,
		(state.viewport.scrollTop / total) * height,
		width,
		Math.max(6, (height / total) * height),
	);
}

interface paintStickyHeadersState {
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
}
export function paintStickyHeaders(state: paintStickyHeadersState): void {
	const first =
		state.visible.find(
			(row) =>
				state.padding + row.index * state.lineHeight >=
				state.viewport.scrollTop,
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
		button.textContent = state.model.getLineContent(fold.start);
		button.onclick = () => state.callbacks.onSelectLine?.(fold.start);
		fragment.append(button);
	}
	state.sticky.replaceChildren(fragment);
	state.sticky.style.left = `${state.viewport.scrollLeft}px`;
	state.sticky.style.top = `${state.viewport.scrollTop}px`;
}
