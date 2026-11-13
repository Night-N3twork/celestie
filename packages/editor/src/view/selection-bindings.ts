import type { EditorOptions } from "../api/editor-options";
import type { TextSelection } from "../api/types";
import { columnRange, displayColumn } from "../features/column-selection";
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
		headPoint: (selection) => renderer.selectionPoint(selection).x,
		horizontalMove: (offset, direction, affinity) =>
			renderer.horizontalMove(offset, direction, affinity),
		hitAffinity: (offset, x) => renderer.hitAffinity(offset, x),
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
		columnSelection: (row, a, b) => {
			const visual = renderer.layout.row(row),
				model = host.model(),
				text = model.getLineContent(visual.line),
				start = model.getInputOffsetAt({
					line: visual.line,
					column: 1,
				});
			const at = (x: number) => {
				const offset = renderer.verticalOffset(
					model.getInputOffsetAt({
						line: visual.line,
						column: visual.from + 1,
					}),
					0,
					x,
				);
				const position = model.getPositionAtInputOffset(offset),
					relative = position.column - 1;
				const point = renderer.point(
					position,
					renderer.visualAffinity(row, offset),
				);
				const column = displayColumn(
					text.slice(0, relative),
					host.options().tabSize,
				);
				const adjustable =
					text[relative] === "\t" ||
					text[relative - 1] === "\t" ||
					(relative === text.length && visual.to === text.length);
				return Math.max(
					displayColumn(
						text.slice(0, visual.from),
						host.options().tabSize,
					),
					column +
						(adjustable
							? Math.round((x - point.x) / renderer.columnWidth)
							: 0),
				);
			};
			return {
				...columnRange(
					text,
					start,
					at(a),
					at(b),
					host.options().tabSize,
				),
				affinity: renderer.visualAffinity(
					row,
					renderer.verticalOffset(start + visual.from, 0, b),
				),
			};
		},
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
