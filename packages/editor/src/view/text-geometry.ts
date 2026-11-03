import type { Position } from "../api/types";
import type { TextModel } from "../model/text-model";

interface RowGeometry {
	readonly element: HTMLElement;
	readonly text: string;
	readonly nodes: readonly Text[];
	readonly ends: readonly number[];
}
export interface TextPoint {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}

export class TextGeometry {
	private readonly rows = new Map<number, RowGeometry>();
	private readonly canvas: CanvasRenderingContext2D | null;
	private readonly segments = new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	});
	private tabSize = 4;
	constructor(
		private readonly viewport: HTMLElement,
		private readonly surface: HTMLElement,
		private readonly getModel: () => TextModel,
		readonly padding = 16,
		readonly lineHeight = 24,
	) {
		this.canvas = viewport.ownerDocument
			.createElement("canvas")
			.getContext("2d");
	}
	clear(): void {
		this.rows.clear();
	}
	hasLine(line: number): boolean {
		return this.rows.has(line);
	}
	setTabSize(value: number): void {
		this.tabSize = value;
	}
	register(line: number, element: HTMLElement, text: string): void {
		const walker = element.ownerDocument.createTreeWalker(
			element,
			NodeFilter.SHOW_TEXT,
		);
		const nodes: Text[] = [],
			ends: number[] = [];
		let length = 0;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			nodes.push(node as Text);
			length += node.textContent?.length ?? 0;
			ends.push(length);
		}
		this.rows.set(line, { element, text, nodes, ends });
	}
	private endpoint(row: RowGeometry, offset: number): [Node, number] {
		for (let index = 0; index < row.nodes.length; index++) {
			const end = row.ends[index] ?? 0;
			if (offset <= end) {
				const node = row.nodes[index];
				if (node)
					return [
						node,
						offset - (index ? (row.ends[index - 1] ?? 0) : 0),
					];
			}
		}
		return [row.element, row.element.childNodes.length];
	}
	private range(row: RowGeometry, from: number, to: number): Range {
		const range = this.viewport.ownerDocument.createRange(),
			start = this.endpoint(row, from),
			end = this.endpoint(row, to);
		range.setStart(...start);
		range.setEnd(...end);
		return range;
	}
	point(position: Position): TextPoint {
		const row = this.rows.get(position.line),
			origin = this.surface.getBoundingClientRect();
		if (row) {
			const column = Math.max(
				0,
				Math.min(row.text.length, position.column - 1),
			);
			const rect = this.range(row, column, column).getClientRects()[0];
			const bounds = row.element.getBoundingClientRect();
			if (rect)
				return {
					x: rect.left - origin.left,
					y: bounds.top - origin.top,
					height: this.lineHeight,
				};
			return {
				x: bounds.left - origin.left,
				y: bounds.top - origin.top,
				height: this.lineHeight,
			};
		}
		const text = this.getModel()
			.getLineContent(position.line)
			.slice(0, position.column - 1);
		return {
			x: this.padding + this.measure(text),
			y: this.padding + (position.line - 1) * this.lineHeight,
			height: this.lineHeight,
		};
	}
	spaceWidth(): number {
		return this.measure(" ");
	}
	private measure(text: string): number {
		const style = getComputedStyle(this.viewport);
		if (this.canvas)
			this.canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const space = this.canvas?.measureText(" ").width ?? 8,
			tab = space * this.tabSize;
		let width = 0;
		const runs = text.split("\t");
		for (let index = 0; index < runs.length; index++) {
			const run = runs[index] ?? "";
			width += this.canvas?.measureText(run).width ?? run.length * space;
			if (index < runs.length - 1)
				width = (Math.floor(width / tab) + 1) * tab;
		}
		return width;
	}
	hitTest(
		x: number,
		y: number,
		scrollTop: number,
		scrollLeft: number,
	): number {
		const model = this.getModel(),
			bounds = this.viewport.getBoundingClientRect();
		const line = Math.max(
			1,
			Math.min(
				model.getLineCount(),
				Math.floor(
					(y - bounds.top + scrollTop - this.padding) /
						this.lineHeight,
				) + 1,
			),
		);
		const text = model.getLineContent(line),
			origin = this.surface.getBoundingClientRect();
		const target = x - origin.left;
		const boundaries = [
			0,
			...Array.from(
				this.segments.segment(text),
				(segment) => segment.index + segment.segment.length,
			),
		];
		const coordinate = (offset: number) =>
			this.rows.has(line)
				? this.point({ line, column: offset + 1 }).x
				: this.padding + this.measure(text.slice(0, offset));
		let offset = 0;
		if (/[\u0590-\u08ff\ufb1d-\ufeff]/u.test(text)) {
			let distance = Infinity;
			for (const boundary of boundaries) {
				const next = Math.abs(
					coordinate(boundary) -
						(this.rows.has(line)
							? target
							: x - bounds.left + scrollLeft),
				);
				if (next < distance) {
					distance = next;
					offset = boundary;
				}
			}
		} else {
			let low = 0,
				high = boundaries.length - 1;
			const px = this.rows.has(line)
				? target
				: x - bounds.left + scrollLeft;
			while (low < high) {
				const mid = Math.floor((low + high) / 2);
				const a = boundaries[mid] ?? 0,
					b = boundaries[mid + 1] ?? text.length;
				if (px < (coordinate(a) + coordinate(b)) / 2) high = mid;
				else low = mid + 1;
			}
			offset = boundaries[low] ?? 0;
		}
		return model.getInputOffsetAt({ line, column: offset + 1 });
	}
	rectangles(
		line: number,
		from: number,
		to: number,
	): readonly { x: number; y: number; width: number; height: number }[] {
		const row = this.rows.get(line);
		if (!row) return [];
		const origin = this.surface.getBoundingClientRect(),
			bounds = row.element.getBoundingClientRect();
		return Array.from(
			this.range(row, from, to).getClientRects(),
			(rect) => ({
				x: rect.left - origin.left,
				y: bounds.top - origin.top,
				width: rect.width,
				height: this.lineHeight,
			}),
		);
	}
}
