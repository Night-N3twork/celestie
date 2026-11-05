import type { Disposable, TextSelection } from "../api/types";
import { wordRange } from "../features/editing-commands";
import {
	anchor,
	caret,
	directed,
	graphemeOffset,
	head,
	normalizeSelections,
	selectionLimit,
} from "../features/selections";
import { getInputLineRange, getInputPosition } from "./input";

interface SelectionHost {
	getText(): string;
	wordPattern(): RegExp;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	offsetAtPoint(x: number, y: number): number;
	columnWidth(): number;
	isComposing(): boolean;
	viewport(): HTMLElement;
	scrollBy(x: number, y: number): void;
	scrollLeft(): number;
	isBounded(): boolean;
	pointAtOffset(offset: number, affinity?: TextSelection["affinity"]): number;
	offsetAtLineX(line: number, x: number): number;
	verticalOffset(
		offset: number,
		rows: number,
		x: number,
		affinity?: TextSelection["affinity"],
	): number;
	verticalMove(
		offset: number,
		rows: number,
		x: number,
		affinity?: TextSelection["affinity"],
	): { offset: number; affinity: "before" | "after" };
	visualAffinity(row: number, offset: number): "before" | "after";

	rowBoundary(
		offset: number,
		end: boolean,
		affinity?: TextSelection["affinity"],
	): number;
	pageRows(): number;
	toggleFold(line: number): void;
	visualIndex(offset: number): number;
	visualRowCount(): number;
	offsetAtVisualRowX(row: number, x: number): number;
	previewDrop(offset: number | undefined): void;
	moveSelection(
		selection: TextSelection,
		target: number,
		copy: boolean,
	): void;
}

export class SelectionController implements Disposable {
	private preferred: number[] = [];
	private rectangle:
		| { line: number; column: number; endLine: number; endColumn: number }
		| undefined;
	private drag:
		| {
				x: number;
				y: number;
				start: number;
				startColumn: number;
				column: boolean;
				mode: "text" | "word" | "line" | "column" | "move";
				anchorEnd: number;
				originX?: number;
				originY?: number;
				moved?: boolean;
				pointer: number;
		  }
		| undefined;
	private animation = 0;
	private lastClick = { time: 0, x: 0, y: 0, count: 0 };
	constructor(
		private readonly input: HTMLTextAreaElement,
		private readonly frame: HTMLElement,
		private readonly host: SelectionHost,
	) {
		input.addEventListener("keydown", this.keydown);
		frame.addEventListener("pointerdown", this.pointerDown, true);
		input.ownerDocument.addEventListener("pointermove", this.pointerMove);
		input.ownerDocument.addEventListener("pointerup", this.pointerUp);
		input.ownerDocument.addEventListener("pointercancel", this.pointerUp);
	}
	reset(): void {
		this.preferred = [];
		this.rectangle = undefined;
		const pointer = this.drag?.pointer;
		if (
			pointer !== undefined &&
			this.host.viewport().hasPointerCapture(pointer)
		)
			this.host.viewport().releasePointerCapture(pointer);
		this.drag = undefined;
		cancelAnimationFrame(this.animation);
		this.animation = 0;
		this.host.previewDrop(undefined);
	}
	move(key: string, extend: boolean): void {
		const text = this.host.getText();
		const values = this.host.getSelections();
		const vertical = [
			"ArrowUp",
			"ArrowDown",
			"PageUp",
			"PageDown",
		].includes(key);
		const next = values.map((selection, index) => {
			const active = head(selection);
			let target = active;
			let affinity: "before" | "after" = "after";
			if (vertical) {
				const column =
					this.preferred[index] ??
					this.host.pointAtOffset(active, selection.affinity);
				this.preferred[index] = column;
				const movement = this.host.verticalMove(
					active,
					(key === "ArrowUp" || key === "PageUp" ? -1 : 1) *
						(key.startsWith("Page") ? this.host.pageRows() : 1),
					column,
					selection.affinity,
				);
				target = movement.offset;
				affinity = movement.affinity;
			} else if (key === "Home" || key === "End") {
				target = this.host.rowBoundary(
					active,
					key === "End",
					selection.affinity,
				);
			} else {
				const direction = key === "ArrowLeft" ? -1 : 1;
				target =
					!extend && selection.start !== selection.end
						? direction < 0
							? selection.start
							: selection.end
						: graphemeOffset(text, active, direction);
			}
			if (key === "End") affinity = "before";
			return extend
				? directed(anchor(selection), target, affinity)
				: caret(target, affinity);
		});
		if (!vertical) this.reset();
		this.host.setSelections(next, true);
	}
	addVertical(direction: -1 | 1): void {
		const values = this.host.getSelections();
		const source = values[0] ?? caret(0);
		if (values.length >= selectionLimit) return;
		const column =
				this.preferred[0] ??
				this.host.pointAtOffset(head(source), source.affinity),
			movement = this.host.verticalMove(
				head(source),
				direction,
				column,
				source.affinity,
			),
			next = caret(movement.offset, movement.affinity);
		if (next.start === head(source)) return;
		this.host.setSelections([next, ...values], true);
		this.preferred = [column, ...this.preferred];
	}
	column(direction: "Up" | "Down" | "Left" | "Right"): void {
		const source = this.host.getSelections()[0] ?? caret(0);
		if (!this.rectangle) {
			const position = { line: this.host.visualIndex(head(source)) };
			const column = this.host.pointAtOffset(head(source));
			this.rectangle = {
				line: position.line,
				column,
				endLine: position.line,
				endColumn: column,
			};
		}
		const rect = this.rectangle,
			count = this.host.visualRowCount();
		rect.endLine = Math.max(
			0,
			Math.min(
				count - 1,
				rect.endLine +
					(direction === "Up" ? -1 : direction === "Down" ? 1 : 0),
			),
		);
		rect.endColumn = Math.max(
			0,
			rect.endColumn +
				(direction === "Left" ? -1 : direction === "Right" ? 1 : 0) *
					this.host.columnWidth(),
		);
		const values: TextSelection[] = [];
		const step = rect.endLine < rect.line ? 1 : -1;
		for (
			let line = rect.endLine;
			values.length < selectionLimit;
			line += step
		) {
			values.push(
				directed(
					this.host.offsetAtVisualRowX(line, rect.column),
					this.host.offsetAtVisualRowX(line, rect.endColumn),
					this.host.visualAffinity(
						line,
						this.host.offsetAtVisualRowX(line, rect.endColumn),
					),
				),
			);
			if (line === rect.line) break;
		}
		this.host.setSelections(values, true);
	}

	private readonly keydown = (event: KeyboardEvent): void => {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			this.host.isComposing()
		)
			return;
		const values = this.host.getSelections();
		if (event.key === "Escape" && values.length > 1) {
			event.preventDefault();
			this.host.setSelections([values[0] ?? caret(0)]);
			this.reset();
			return;
		}
		if (values.length < 2 && !this.host.isBounded()) return;
		if (
			(event.ctrlKey || event.metaKey) &&
			!event.altKey &&
			(event.key === "Home" || event.key === "End")
		) {
			event.preventDefault();
			this.reset();
			const offset =
				event.key === "Home" ? 0 : this.host.getText().length;
			this.host.setSelections(
				event.shiftKey
					? values.map((value) => directed(anchor(value), offset))
					: [caret(offset)],
				true,
			);
			return;
		}
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (
			[
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"PageUp",
				"PageDown",
				"Home",
				"End",
			].includes(event.key)
		) {
			event.preventDefault();
			this.move(event.key, event.shiftKey);
		}
	};
	private readonly pointerDown = (event: PointerEvent): void => {
		if (
			event.button !== 0 ||
			this.host.isComposing() ||
			!(event.target instanceof Element)
		)
			return;
		if (event.target.closest(".editor-sticky button,[data-editor-widget]"))
			return;
		const fold = event.target.closest<HTMLElement>("[data-fold]");
		if (fold) {
			event.preventDefault();
			event.stopPropagation();
			this.host.toggleFold(Number(fold.dataset.fold));
			this.input.focus({ preventScroll: true });
			return;
		}
		const gutter = event.target.closest(".editor-gutter");
		const viewport = this.host.viewport();
		if (!gutter && viewport.contains(event.target)) {
			const bounds = viewport.getBoundingClientRect();
			if (
				event.clientX >=
					bounds.left + viewport.clientLeft + viewport.clientWidth ||
				event.clientY >=
					bounds.top + viewport.clientTop + viewport.clientHeight
			)
				return;
		}
		const bounded = this.host.isBounded();
		if (
			event.target !== this.input &&
			!gutter &&
			!(bounded && this.host.viewport().contains(event.target))
		)
			return;
		this.reset();
		const offset = this.host.offsetAtPoint(event.clientX, event.clientY);
		if (gutter || (event.altKey && event.shiftKey)) {
			event.preventDefault();
			event.stopPropagation();
			this.input.focus({ preventScroll: true });
			this.drag = {
				x: event.clientX,
				y: event.clientY,
				start: offset,
				startColumn: this.columnAtPoint(event.clientX),
				column: !gutter,
				mode: gutter ? "line" : "column",
				anchorEnd: offset,
				pointer: event.pointerId,
			};
			this.updateDrag();
			this.host.viewport().setPointerCapture(event.pointerId);
			this.tick();
		} else if (event.altKey && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			this.input.focus({ preventScroll: true });
			const values = this.host.getSelections();
			const existing = values.findIndex(
				(value) => offset >= value.start && offset <= value.end,
			);
			this.host.setSelections(
				existing >= 0 && values.length > 1
					? values.filter((_, index) => index !== existing)
					: values.length < selectionLimit
						? [caret(offset), ...values]
						: values,
			);
		} else if (bounded) {
			event.preventDefault();
			this.input.focus({ preventScroll: true });
			const click = this.lastClick,
				time = Date.now();
			const count =
				time - click.time < 500 &&
				Math.abs(click.x - event.clientX) < 5 &&
				Math.abs(click.y - event.clientY) < 5
					? (click.count % 3) + 1
					: 1;
			this.lastClick = {
				time,
				x: event.clientX,
				y: event.clientY,
				count,
			};
			const word = wordRange(
				this.host.getText(),
				offset,
				this.host.wordPattern(),
			);
			const primary = this.host.getSelections()[0] ?? caret(0);
			this.drag = {
				x: event.clientX,
				y: event.clientY,
				start: event.shiftKey
					? anchor(primary)
					: count === 2
						? word.from
						: offset,
				anchorEnd: count === 2 ? word.to : offset,
				startColumn: this.columnAtPoint(event.clientX),
				column: false,
				mode:
					count === 3
						? "line"
						: count === 2
							? "word"
							: !event.shiftKey &&
									primary.start !== primary.end &&
									offset >= primary.start &&
									offset <= primary.end
								? "move"
								: "text",
				pointer: event.pointerId,
			};
			if (this.drag.mode === "move") {
				this.drag.start = primary.start;
				this.drag.anchorEnd = primary.end;
				this.drag.originX = event.clientX;
				this.drag.originY = event.clientY;
			}
			this.updateDrag();
			this.host.viewport().setPointerCapture(event.pointerId);
			this.tick();
		} else if (this.host.getSelections().length > 1)
			this.host.setSelections([this.host.getSelections()[0] ?? caret(0)]);
	};
	private readonly pointerMove = (event: PointerEvent): void => {
		if (!this.drag || event.pointerId !== this.drag.pointer) return;
		event.preventDefault();
		this.drag.x = event.clientX;
		this.drag.y = event.clientY;
		if (
			this.drag.mode === "move" &&
			(Math.abs(event.clientX - (this.drag.originX ?? event.clientX)) >
				4 ||
				Math.abs(event.clientY - (this.drag.originY ?? event.clientY)) >
					4)
		)
			this.drag.moved = true;
		this.updateDrag();
	};
	private readonly pointerUp = (event: PointerEvent): void => {
		if (event.pointerId !== this.drag?.pointer) return;
		const drag = this.drag;
		if (drag?.mode === "move" && event.type !== "pointercancel") {
			const target = this.host.offsetAtPoint(
				event.clientX,
				event.clientY,
			);
			if (drag.moved)
				this.host.moveSelection(
					{
						start: drag.start,
						end: drag.anchorEnd,
						direction: "forward",
					},
					target,
					event.ctrlKey || event.metaKey,
				);
			else this.host.setSelections([caret(target)]);
			this.host.previewDrop(undefined);
		}
		this.drag = undefined;
		this.host.previewDrop(undefined);
		cancelAnimationFrame(this.animation);
		this.animation = 0;
	};
	private columnAtPoint(x: number): number {
		return Math.max(
			0,
			x -
				this.host.viewport().getBoundingClientRect().left +
				this.host.scrollLeft(),
		);
	}

	private updateDrag(): void {
		const drag = this.drag;
		if (!drag) return;
		const text = this.host.getText();
		const end = this.host.offsetAtPoint(drag.x, drag.y);
		if (drag.mode === "move") {
			if (drag.moved) this.host.previewDrop(end);
			return;
		}
		const first = getInputPosition(text, drag.start),
			last = getInputPosition(text, end);
		if (drag.mode === "text") {
			this.host.setSelections([directed(drag.start, end)]);
			return;
		}
		if (drag.mode === "word") {
			const range = wordRange(text, end, this.host.wordPattern());
			this.host.setSelections([
				end < drag.start
					? directed(drag.anchorEnd, range.from)
					: directed(drag.start, Math.max(drag.anchorEnd, range.to)),
			]);
			return;
		}
		if (drag.mode === "line") {
			const start = getInputLineRange(
				text,
				Math.min(first.line, last.line),
			).from;
			const finish = getInputLineRange(
				text,
				Math.max(first.line, last.line),
			).to;
			this.host.setSelections([
				{
					start,
					end: finish,
					direction: last.line < first.line ? "backward" : "forward",
				},
			]);
			return;
		}
		const a = drag.startColumn;
		const b = this.columnAtPoint(drag.x);
		const values: TextSelection[] = [];
		const firstRow = this.host.visualIndex(drag.start),
			lastRow = this.host.visualIndex(end);
		const direction = lastRow < firstRow ? -1 : 1;
		for (
			let line = lastRow;
			values.length < selectionLimit;
			line -= direction
		) {
			values.push(
				directed(
					this.host.offsetAtVisualRowX(line, a),
					this.host.offsetAtVisualRowX(line, b),
					this.host.visualAffinity(
						line,
						this.host.offsetAtVisualRowX(line, b),
					),
				),
			);
			if (line === firstRow) break;
		}
		this.host.setSelections(normalizeSelections(values, text.length));
	}
	private tick = (): void => {
		if (!this.drag) return;
		const bounds = this.host.viewport().getBoundingClientRect(),
			drag = this.drag;
		const dy =
			drag.y < bounds.top
				? drag.y - bounds.top
				: drag.y > bounds.bottom
					? drag.y - bounds.bottom
					: 0;
		const dx =
			drag.x < bounds.left
				? drag.x - bounds.left
				: drag.x > bounds.right
					? drag.x - bounds.right
					: 0;
		if (dy || dx) {
			this.host.scrollBy(
				Math.sign(dx) * Math.min(48, Math.abs(dx) / 3 + 4),
				Math.sign(dy) * Math.min(48, Math.abs(dy) / 3 + 4),
			);
			this.updateDrag();
		}
		this.animation = requestAnimationFrame(this.tick);
	};
	dispose(): void {
		cancelAnimationFrame(this.animation);
		this.drag = undefined;
		this.input.removeEventListener("keydown", this.keydown);
		this.frame.removeEventListener("pointerdown", this.pointerDown, true);
		this.input.ownerDocument.removeEventListener(
			"pointermove",
			this.pointerMove,
		);
		this.input.ownerDocument.removeEventListener(
			"pointerup",
			this.pointerUp,
		);
		this.input.ownerDocument.removeEventListener(
			"pointercancel",
			this.pointerUp,
		);
	}
}
