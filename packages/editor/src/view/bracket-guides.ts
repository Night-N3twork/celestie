import type { EditorOptions } from "../api/editor-options";
import type { TextModel } from "../model/text-model";
import type { TextGeometry } from "./text-geometry";
import type { VisualLayout, VisualRow } from "./visual-layout";

export interface BracketGuide {
	readonly from: number;
	readonly to: number;
	readonly depth: number;
}
export function paintBracketGuides(
	state: {
		readonly options: EditorOptions;
		readonly pairs: readonly BracketGuide[];
		readonly offset: number;
		readonly model: TextModel;
		readonly geometry: TextGeometry;
		readonly visible: readonly VisualRow[];
		readonly layout: VisualLayout;
		readonly padding: number;
		readonly originY: number;
		readonly lineHeight: number;
		readonly accessible: boolean;
	},
	rectangle: (
		name: string,
		x: number,
		y: number,
		width: number,
		height: number,
	) => void,
): void {
	if (state.options.bracketGuides === "none" || state.accessible) return;
	let active: BracketGuide | undefined;
	for (const pair of state.pairs)
		if (
			pair.from <= state.offset &&
			pair.to + 1 >= state.offset &&
			(!active || pair.from > active.from)
		)
			active = pair;
	const textRows = state.visible.filter((row) => !row.kind);
	const first = textRows[0]?.line ?? 0,
		last = textRows.at(-1)?.line ?? 0;
	for (const pair of state.options.bracketGuides === "active"
		? active
			? [active]
			: []
		: state.pairs) {
		const open = state.model.getPositionAtInputOffset(pair.from),
			close = state.model.getPositionAtInputOffset(pair.to);
		if (open.line === close.line || open.line > last || close.line < first)
			continue;
		const x = Math.min(
			state.geometry.point(open).x,
			state.geometry.point(close).x,
		);
		for (const row of textRows)
			if (row.line > open.line && row.line <= close.line)
				rectangle(
					`editor-bracket-guide editor-bracket-guide-${pair.depth % 3}${pair === active ? " editor-bracket-guide-active" : ""}`,
					x,
					state.padding +
						state.layout.rowTop(row.index) -
						state.originY,
					1,
					state.lineHeight,
				);
	}
}
