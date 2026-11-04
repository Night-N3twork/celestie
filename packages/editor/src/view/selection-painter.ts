import type { EditorOptions } from "../api/editor-options";
import type { Position, TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TextGeometry, TextPoint } from "./text-geometry";
import type { VisualLayout, VisualRow } from "./visual-layout";

interface paintSelectionLayersState {
	readonly root: HTMLElement;
	readonly visible: readonly VisualRow[];
	readonly accessible: boolean;
	readonly selections: readonly TextSelection[];
	readonly model: TextModel;
	readonly geometry: TextGeometry;
	readonly originY: number;
	readonly originX: number;
	readonly lineHeight: number;
	readonly layout: VisualLayout;
	readonly dropOffset: number | undefined;
	readonly options: EditorOptions;
	readonly columnWidth: number;
	readonly padding: number;
	readonly viewport: HTMLElement;
	readonly selectionLayer: HTMLElement;
	readonly rulerLayer: HTMLElement;
	readonly input: HTMLTextAreaElement | undefined;
	readonly point: (
		position: Position,
		affinity?: "before" | "after",
	) => TextPoint;
}
export function paintSelectionLayers(state: paintSelectionLayersState): void {
	const fragment = state.root.ownerDocument.createDocumentFragment();
	const rectangle = (
		name: string,
		x: number,
		y: number,
		width: number,
		height: number,
	) => {
		const left = state.accessible ? 0 : state.viewport.scrollLeft,
			top = state.accessible ? 0 : state.viewport.scrollTop;
		const right = Math.min(x + width, left + state.viewport.clientWidth);
		x = Math.max(x, left);
		if (
			right <= x ||
			y + height < top ||
			y > top + state.viewport.clientHeight
		)
			return;
		width = right - x;
		const node = state.root.ownerDocument.createElement("div");
		node.className = name;
		node.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
		fragment.append(node);
	};
	const lines = new Set(state.visible.map((row) => row.line));
	for (const selection of state.accessible
		? state.selections.slice(1)
		: state.selections) {
		const start = state.model.getPositionAtInputOffset(selection.start),
			end = state.model.getPositionAtInputOffset(selection.end);
		if (selection.start !== selection.end)
			for (const line of lines) {
				if (line < start.line || line > end.line) continue;
				const content = state.model.getLineContent(line),
					from = line === start.line ? start.column - 1 : 0,
					to = line === end.line ? end.column - 1 : content.length;
				for (const rect of state.geometry.rectangles(line, from, to))
					if (rect.width > 0)
						rectangle(
							"editor-custom-selection",
							rect.x,
							rect.y,
							rect.width,
							rect.height,
						);
				if (line < end.line) {
					const point = state.geometry.point({
						line,
						column: content.length + 1,
					});
					rectangle(
						"editor-custom-selection",
						point.x,
						point.y,
						8,
						state.lineHeight,
					);
				}
			}
		const active = selection.direction === "backward" ? start : end,
			visual = state.layout.position(
				active.line,
				active.column,
				selection.affinity,
			);
		if (state.visible.some((row) => row.index === visual.index)) {
			const point = state.geometry.point(active, selection.affinity);
			rectangle("editor-custom-caret", point.x, point.y, 2, point.height);
		}
	}
	if (state.dropOffset !== undefined) {
		const point = state.geometry.point(
			state.model.getPositionAtInputOffset(state.dropOffset),
		);
		rectangle(
			"editor-custom-caret editor-drop-caret",
			point.x,
			point.y,
			2,
			point.height,
		);
	}
	if (state.options.indentGuides)
		for (const row of state.visible) {
			if (row.from) continue;
			const text = state.model.getLineContent(row.line),
				leading = text.match(/^[\t ]*/)?.[0] ?? "",
				width = state.geometry.measure(leading),
				tab = state.columnWidth * state.options.tabSize;
			for (
				let x = Math.max(
					tab,
					Math.floor(
						(state.viewport.scrollLeft +
							state.originX -
							state.padding) /
							tab,
					) * tab,
				);
				x <
				Math.min(
					width,
					state.viewport.scrollLeft +
						state.originX +
						state.viewport.clientWidth,
				);
				x += tab
			)
				rectangle(
					"editor-indent-guide",
					state.padding + x - state.originX,
					state.padding +
						row.index * state.lineHeight -
						state.originY -
						(state.accessible ? state.viewport.scrollTop : 0),
					1,
					state.lineHeight,
				);
		}
	state.selectionLayer.replaceChildren(fragment);
	const rulerFragment = state.root.ownerDocument.createDocumentFragment();
	for (const column of state.options.rulers) {
		const x = state.padding + column * state.columnWidth - state.originX;
		if (
			x < state.viewport.scrollLeft ||
			x > state.viewport.scrollLeft + state.viewport.clientWidth
		)
			continue;
		const ruler = state.root.ownerDocument.createElement("div");
		ruler.className = "editor-ruler";
		ruler.style.left = `${x}px`;
		rulerFragment.append(ruler);
	}
	state.rulerLayer.replaceChildren(rulerFragment);
	if (state.input && !state.accessible && state.selections[0]) {
		const selection = state.selections[0],
			point = state.point(
				state.model.getPositionAtInputOffset(
					selection.direction === "backward"
						? selection.start
						: selection.end,
				),
				selection.affinity,
			);
		state.input.style.left = `${Math.max(state.viewport.scrollLeft, Math.min(point.x - state.originX, state.viewport.scrollLeft + state.viewport.clientWidth - 4))}px`;
		state.input.style.top = `${Math.max(state.viewport.scrollTop, Math.min(point.y - state.originY, state.viewport.scrollTop + state.viewport.clientHeight - state.lineHeight))}px`;
		state.input.style.height = `${state.lineHeight}px`;
	}
}
