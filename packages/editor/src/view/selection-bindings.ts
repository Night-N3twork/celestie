import type { EditorOptions } from "../api/editor-options";
import type { TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { InputSurface } from "./input-surface";
import { SelectionController } from "./selection-controller";
import type { TextRenderer } from "./text-renderer";

interface Host {
	model(): TextModel;
	options(): EditorOptions;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	offsetAtPoint(x: number, y: number): number;
	toggleFold(line: number): void;
	moveSelection(
		selection: TextSelection,
		target: number,
		copy: boolean,
	): void;
	isComposing(): boolean;
	wordPattern(): RegExp;
}
export function createSelectionController(
	input: InputSurface,
	frame: HTMLElement,
	renderer: TextRenderer,
	host: Host,
): SelectionController {
	return new SelectionController(input.native, frame, {
		getText: () => input.value,
		getSelections: () => host.getSelections(),
		setSelections: (values, reveal = false) =>
			host.setSelections(values, reveal),
		offsetAtPoint: (x, y) => host.offsetAtPoint(x, y),
		columnWidth: () => renderer.columnWidth,
		viewport: () => input.viewport,
		scrollLeft: () => input.scrollLeft,
		scrollBy: (x, y) => {
			input.scrollTop += y;
			input.scrollLeft += x;
			renderer.render();
		},
		pointAtOffset: (offset, affinity) =>
			renderer.point(
				host.model().getPositionAtInputOffset(offset),
				affinity,
			).x,
		offsetAtLineX: (line, x) => renderer.offsetAtLineX(line, x),
		verticalMove: (offset, rows, x, affinity) =>
			renderer.verticalMove(offset, rows, x, affinity),
		visualAffinity: (row, offset) => renderer.visualAffinity(row, offset),
		verticalOffset: (offset, rows, x, affinity) =>
			renderer.verticalOffset(offset, rows, x, affinity),
		rowBoundary: (offset, end, affinity) =>
			renderer.rowBoundary(offset, end, affinity),
		pageRows: () =>
			Math.max(
				1,
				Math.floor(input.clientHeight / host.options().lineHeight) - 1,
			),
		toggleFold: (line) => host.toggleFold(line),
		wordPattern: () => host.wordPattern(),
		visualIndex: (offset, affinity) => {
			const position = host.model().getPositionAtInputOffset(offset);
			return renderer.layout.position(
				position.line,
				position.column,
				affinity,
			).index;
		},
		visualRowCount: () => renderer.layout.rowCount,
		isTextRow: (row) => renderer.layout.row(row).kind !== "zone",
		offsetAtVisualRowX: (row, x) =>
			renderer.verticalOffset(
				host.model().getInputOffsetAt({
					line: renderer.layout.row(row).line,
					column: renderer.layout.row(row).from + 1,
				}),
				0,
				x,
			),
		isBounded: () => host.options().accessibilitySupport !== "on",
		previewDrop: (offset) => renderer.setDropOffset(offset),
		moveSelection: (selection, target, copy) =>
			host.moveSelection(selection, target, copy),
		isComposing: () => host.isComposing(),
	});
}
