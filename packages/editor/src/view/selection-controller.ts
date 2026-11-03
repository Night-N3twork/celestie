import type { Disposable, TextSelection } from "../api/types";
import {
	anchor,
	caret,
	directed,
	graphemeOffset,
	head,
	normalizeSelections,
	offsetAtColumn,
	selectionLimit,
	visualColumn,
} from "../features/selections";
import { getInputLineRange, getInputPosition } from "./input";

interface SelectionHost {
	getText(): string;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	offsetAtPoint(x: number, y: number): number;
	getTabSize(): number;
	isComposing(): boolean;
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
				pointer: number;
		  }
		| undefined;
	private animation = 0;
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
			const active = head(selection),
				position = getInputPosition(text, active);
			let target = active;
			if (vertical) {
				const line = getInputLineRange(text, position.line);
				const column =
					this.preferred[index] ??
					visualColumn(
						text.slice(line.from, active),
						this.host.getTabSize(),
					);
				this.preferred[index] = column;
				const count = text.split("\n").length;
				const number = Math.max(
					1,
					Math.min(
						count,
						position.line +
							(key === "ArrowUp" || key === "PageUp" ? -1 : 1) *
								(key.startsWith("Page")
									? Math.max(
											1,
											Math.floor(
												this.input.clientHeight / 24,
											) - 1,
										)
									: 1),
					),
				);
				const range = getInputLineRange(text, number);
				const end =
					text[range.to - 1] === "\n" ? range.to - 1 : range.to;
				target =
					range.from +
					offsetAtColumn(
						text.slice(range.from, end),
						column,
						this.host.getTabSize(),
					);
			} else if (key === "Home" || key === "End") {
				const range = getInputLineRange(text, position.line);
				target =
					key === "Home"
						? range.from
						: range.to - (text[range.to - 1] === "\n" ? 1 : 0);
			} else {
				const direction = key === "ArrowLeft" ? -1 : 1;
				target =
					!extend && selection.start !== selection.end
						? direction < 0
							? selection.start
							: selection.end
						: graphemeOffset(text, active, direction);
			}
			return extend ? directed(anchor(selection), target) : caret(target);
		});
		if (!vertical) this.reset();
		this.host.setSelections(next, true);
	}
	addVertical(direction: -1 | 1): void {
		const text = this.host.getText(),
			values = this.host.getSelections();
		const source = values[0] ?? caret(0),
			position = getInputPosition(text, head(source));
		const line = position.line + direction;
		if (
			line < 1 ||
			line > text.split("\n").length ||
			values.length >= selectionLimit
		)
			return;
		const old = getInputLineRange(text, position.line),
			range = getInputLineRange(text, line);
		const column =
			this.preferred[0] ??
			visualColumn(
				text.slice(old.from, head(source)),
				this.host.getTabSize(),
			);
		const end = range.to - (text[range.to - 1] === "\n" ? 1 : 0);
		const next = caret(
			range.from +
				offsetAtColumn(
					text.slice(range.from, end),
					column,
					this.host.getTabSize(),
				),
		);
		this.host.setSelections([next, ...values], true);
		this.preferred = [column, ...this.preferred];
	}
	column(direction: "Up" | "Down" | "Left" | "Right"): void {
		const text = this.host.getText(),
			source = this.host.getSelections()[0] ?? caret(0);
		if (!this.rectangle) {
			const position = getInputPosition(text, head(source)),
				range = getInputLineRange(text, position.line);
			const column = visualColumn(
				text.slice(range.from, head(source)),
				this.host.getTabSize(),
			);
			this.rectangle = {
				line: position.line,
				column,
				endLine: position.line,
				endColumn: column,
			};
		}
		const rect = this.rectangle,
			count = text.split("\n").length;
		rect.endLine = Math.max(
			1,
			Math.min(
				count,
				rect.endLine +
					(direction === "Up" ? -1 : direction === "Down" ? 1 : 0),
			),
		);
		rect.endColumn = Math.max(
			0,
			rect.endColumn +
				(direction === "Left" ? -1 : direction === "Right" ? 1 : 0),
		);
		const values: TextSelection[] = [];
		const step = rect.endLine < rect.line ? 1 : -1;
		for (
			let line = rect.endLine;
			values.length < selectionLimit;
			line += step
		) {
			const range = getInputLineRange(text, line),
				end = range.to - (text[range.to - 1] === "\n" ? 1 : 0),
				content = text.slice(range.from, end);
			values.push(
				directed(
					range.from +
						offsetAtColumn(
							content,
							rect.column,
							this.host.getTabSize(),
						),
					range.from +
						offsetAtColumn(
							content,
							rect.endColumn,
							this.host.getTabSize(),
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
		if (values.length < 2) return;
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
		const gutter = event.target.closest(".editor-gutter");
		if (event.target !== this.input && !gutter) return;
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
				pointer: event.pointerId,
			};
			this.updateDrag();
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
		} else if (this.host.getSelections().length > 1)
			this.host.setSelections([this.host.getSelections()[0] ?? caret(0)]);
	};
	private readonly pointerMove = (event: PointerEvent): void => {
		if (!this.drag || event.pointerId !== this.drag.pointer) return;
		event.preventDefault();
		this.drag.x = event.clientX;
		this.drag.y = event.clientY;
		this.updateDrag();
	};
	private readonly pointerUp = (event: PointerEvent): void => {
		if (event.pointerId !== this.drag?.pointer) return;
		this.drag = undefined;
		cancelAnimationFrame(this.animation);
		this.animation = 0;
	};
	private columnAtPoint(x: number): number {
		const context = this.input.ownerDocument
			.createElement("canvas")
			.getContext("2d");
		if (context) context.font = "16px monospace";
		return Math.max(
			0,
			Math.round(
				(x -
					this.input.getBoundingClientRect().left -
					16 +
					this.input.scrollLeft) /
					(context?.measureText(" ").width ?? 8),
			),
		);
	}

	private updateDrag(): void {
		const drag = this.drag;
		if (!drag) return;
		const text = this.host.getText();
		const end = this.host.offsetAtPoint(drag.x, drag.y);
		const first = getInputPosition(text, drag.start),
			last = getInputPosition(text, end);
		if (!drag.column) {
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
		const direction = last.line < first.line ? -1 : 1;
		for (
			let line = last.line;
			values.length < selectionLimit;
			line -= direction
		) {
			const range = getInputLineRange(text, line),
				limit = range.to - (text[range.to - 1] === "\n" ? 1 : 0);
			const content = text.slice(range.from, limit);
			values.push(
				directed(
					range.from +
						offsetAtColumn(content, a, this.host.getTabSize()),
					range.from +
						offsetAtColumn(content, b, this.host.getTabSize()),
				),
			);
			if (line === first.line) break;
		}
		this.host.setSelections(normalizeSelections(values, text.length));
	}
	private tick = (): void => {
		if (!this.drag) return;
		const bounds = this.input.getBoundingClientRect(),
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
			this.input.scrollTop +=
				Math.sign(dy) * Math.min(48, Math.abs(dy) / 3 + 4);
			this.input.scrollLeft +=
				Math.sign(dx) * Math.min(48, Math.abs(dx) / 3 + 4);
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
