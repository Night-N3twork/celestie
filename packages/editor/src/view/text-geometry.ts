import type { Position } from "../api/types";
import type { TextModel } from "../model/text-model";
import { LineMetrics, longLineLimit } from "./line-metrics";
import { calibrationSamples, hasRightToLeft } from "./text-shaping";
import type { VisualLayout, VisualRow } from "./visual-layout";

interface RowGeometry {
	element: HTMLElement;
	row: VisualRow;
	nodes: Text[];
	ends: number[];
}
export interface TextPoint {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}
export class TextGeometry {
	private rows = new Map<number, RowGeometry>();
	private readonly canvas: CanvasRenderingContext2D | null;
	private readonly segments = new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	});
	private tabSize = 4;
	private font = "16px monospace";
	private widths = new Map<string, number>();
	private metrics = new Map<number, LineMetrics>();
	private probe: HTMLSpanElement | undefined;
	private domMeasurement = false;
	get measuresWithDom(): boolean {
		return this.domMeasurement;
	}
	originY = 0;
	originX = 0;
	private lineMetrics(line: number): LineMetrics {
		const text = this.model().getLineContent(line);
		let metrics = this.metrics.get(line);
		if (!metrics || metrics.text !== text) {
			metrics = new LineMetrics(text, (value, initial) =>
				this.measure(value, initial),
			);
			if (this.metrics.size >= 16) this.metrics.clear();
			this.metrics.set(line, metrics);
		}
		return metrics;
	}
	window(row: VisualRow, left: number, width: number): VisualRow {
		if (row.kind || row.to - row.from <= longLineLimit) return row;
		const metrics = this.lineMetrics(row.line),
			from = metrics.offsetAt(Math.max(0, left - this.padding - 256)),
			to = metrics.offsetAt(left + width + 256);
		return { ...row, from, to, indent: metrics.xAt(from) };
	}
	rowWidth(row: VisualRow): number {
		return row.to - row.from > longLineLimit
			? this.lineMetrics(row.line).width
			: this.measure(
					this.model()
						.getLineContent(row.line)
						.slice(row.from, row.to),
				) + row.indent;
	}
	resetMeasurements(): void {
		const style = getComputedStyle(this.viewport);
		this.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		this.widths.clear();
		this.metrics.clear();
		this.domMeasurement = false;
		if (!this.canvas) {
			this.domMeasurement = true;
			return;
		}
		for (const sample of calibrationSamples) {
			const canvas = this.measureRun(sample),
				dom = this.measureDom(sample);
			if (Math.abs(canvas - dom) > Math.max(0.5, dom * 0.005)) {
				this.domMeasurement = true;
				break;
			}
		}
		this.widths.clear();
	}
	private measureDom(text: string): number {
		if (!this.probe) {
			this.probe = this.viewport.ownerDocument.createElement("span");
			this.probe.className = "editor-measure-probe";
			this.probe.setAttribute("aria-hidden", "true");
		}
		if (!this.probe.isConnected) this.surface.append(this.probe);
		this.probe.textContent = text;
		return this.probe.getBoundingClientRect().width;
	}
	private measureRun(text: string): number {
		if (!text) return 0;
		if (this.domMeasurement || !this.canvas) return this.measureDom(text);
		this.canvas.font = this.font;
		return this.canvas.measureText(text).width;
	}
	lineHeight = 24;
	constructor(
		private readonly viewport: HTMLElement,
		private readonly surface: HTMLElement,
		private readonly model: () => TextModel,
		private readonly layout: VisualLayout,
		readonly padding = 16,
	) {
		this.canvas = viewport.ownerDocument
			.createElement("canvas")
			.getContext("2d");
	}
	clear(): void {
		this.rows.clear();
	}
	dispose(): void {
		this.clear();
		this.metrics.clear();
		this.widths.clear();
		this.probe?.remove();
		this.probe = undefined;
	}
	hasLine(line: number): boolean {
		return [...this.rows.values()].some((value) => value.row.line === line);
	}
	setTabSize(value: number): void {
		this.tabSize = value;
		this.widths.clear();
	}
	register(row: VisualRow, element: HTMLElement): void {
		const walker = element.ownerDocument.createTreeWalker(
				element,
				NodeFilter.SHOW_TEXT,
			),
			nodes: Text[] = [],
			ends: number[] = [];
		let length = row.from;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.parentElement?.closest(".editor-inlay-hint")) continue;
			nodes.push(node as Text);
			length += node.textContent?.length ?? 0;
			ends.push(length);
		}
		this.rows.set(row.index, { element, row, nodes, ends });
	}
	private endpoint(
		row: RowGeometry,
		offset: number,
		after = false,
	): [Node, number] {
		for (let i = 0; i < row.nodes.length; i++) {
			const end = row.ends[i] ?? 0,
				node = row.nodes[i];
			if (
				node &&
				(offset < end ||
					(offset === end && (!after || i === row.nodes.length - 1)))
			)
				return [
					node,
					Math.max(
						0,
						offset -
							(i
								? (row.ends[i - 1] ?? row.row.from)
								: row.row.from),
					),
				];
		}
		return [row.element, row.element.childNodes.length];
	}
	private range(row: RowGeometry, from: number, to: number): Range {
		const range = this.viewport.ownerDocument.createRange();
		range.setStart(...this.endpoint(row, from, true));
		range.setEnd(...this.endpoint(row, to, from === to));
		return range;
	}
	point(
		position: Position,
		affinity: "before" | "after" = "after",
	): TextPoint {
		const segment = this.layout.position(
				position.line,
				position.column,
				affinity,
			),
			row = this.rows.get(segment.index),
			origin = this.surface.getBoundingClientRect();
		if (
			row &&
			position.column - 1 >= row.row.from &&
			position.column - 1 <= row.row.to
		) {
			const column = Math.max(
					row.row.from,
					Math.min(row.row.to, position.column - 1),
				),
				rect = this.range(row, column, column).getClientRects()[0],
				bounds = row.element.getBoundingClientRect();
			return {
				x: (rect?.left ?? bounds.left) - origin.left,
				y: bounds.top - origin.top,
				height: this.lineHeight,
			};
		}
		const text = this.model().getLineContent(segment.line);
		return {
			x:
				this.padding +
				segment.indent +
				(text.length > longLineLimit
					? this.lineMetrics(segment.line).xAt(position.column - 1)
					: this.measure(
							text.slice(segment.from, position.column - 1),
						)) -
				this.originX,
			y: this.padding + segment.index * this.lineHeight - this.originY,
			height: this.lineHeight,
		};
	}
	spaceWidth(): number {
		return this.measure(" ");
	}
	private spaceAdvance(): number {
		let width = this.widths.get(" ");
		if (width === undefined) {
			width = this.measureRun(" ") || 8;
			this.widths.set(" ", width);
		}
		return width;
	}
	measure(text: string, initial = 0): number {
		const cached = initial === 0 ? this.widths.get(text) : undefined;
		if (cached !== undefined) return cached;
		const space = this.spaceAdvance(),
			tab = space * this.tabSize;
		let width = initial;
		const runs = text.split("\t");
		for (let i = 0; i < runs.length; i++) {
			const run = runs[i] ?? "";
			width += this.measureRun(run);
			if (i < runs.length - 1)
				width = (Math.floor(width / tab) + 1) * tab;
		}
		width -= initial;
		if (initial === 0 && text.length < 128) {
			if (this.widths.size >= 20000) this.widths.clear();
			this.widths.set(text, width);
		}
		return width;
	}
	hitTest(
		x: number,
		y: number,
		scrollTop: number,
		scrollLeft: number,
	): number {
		const bounds = this.viewport.getBoundingClientRect(),
			index = Math.floor(
				(y - bounds.top + scrollTop - this.padding) / this.lineHeight,
			),
			row = this.layout.row(index);
		return this.offsetAtRowX(row.index, x - bounds.left + scrollLeft);
	}
	offsetAtRowX(index: number, x: number): number {
		const model = this.model(),
			segment = this.layout.row(index),
			text = model.getLineContent(segment.line),
			row = this.rows.get(segment.index),
			origin = this.surface.getBoundingClientRect();
		const mounted = row?.element.getBoundingClientRect();
		if (
			text.length > longLineLimit &&
			(!mounted ||
				x < mounted.left - origin.left + this.originX ||
				x > mounted.right - origin.left + this.originX)
		)
			return model.getInputOffsetAt({
				line: segment.line,
				column:
					this.lineMetrics(segment.line).offsetAt(x - this.padding) +
					1,
			});
		const measured = row?.row ?? segment;
		const boundaries = [
			measured.from,
			...Array.from(
				this.segments.segment(text.slice(measured.from, measured.to)),
				(unit) => measured.from + unit.index + unit.segment.length,
			),
		];
		const coordinate = (offset: number) => {
			if (row) {
				const rect = this.range(
					row,
					offset,
					offset,
				).getClientRects()[0];
				return (
					(rect?.left ?? row.element.getBoundingClientRect().left) -
					origin.left +
					this.originX
				);
			}
			return (
				this.padding +
				segment.indent +
				this.measure(text.slice(segment.from, offset))
			);
		};
		let offset = segment.from;
		if (hasRightToLeft(text.slice(measured.from, measured.to))) {
			let distance = Infinity;
			for (const boundary of boundaries) {
				const next = Math.abs(coordinate(boundary) - x);
				if (next < distance) {
					distance = next;
					offset = boundary;
				}
			}
		} else {
			let low = 0,
				high = boundaries.length - 1;
			while (low < high) {
				const mid = Math.floor((low + high) / 2),
					a = boundaries[mid] ?? segment.from,
					b = boundaries[mid + 1] ?? segment.to;
				if (x < (coordinate(a) + coordinate(b)) / 2) high = mid;
				else low = mid + 1;
			}
			offset = boundaries[low] ?? segment.from;
		}
		return model.getInputOffsetAt({
			line: segment.line,
			column: offset + 1,
		});
	}
	rectangles(
		line: number,
		from: number,
		to: number,
	): readonly { x: number; y: number; width: number; height: number }[] {
		const origin = this.surface.getBoundingClientRect(),
			result: { x: number; y: number; width: number; height: number }[] =
				[];
		for (const row of this.rows.values()) {
			if (
				row.row.line !== line ||
				to <= row.row.from ||
				from >= row.row.to
			)
				continue;
			const bounds = row.element.getBoundingClientRect();
			for (const rect of this.range(
				row,
				Math.max(from, row.row.from),
				Math.min(to, row.row.to),
			).getClientRects())
				result.push({
					x: rect.left - origin.left,
					y: bounds.top - origin.top,
					width: rect.width,
					height: this.lineHeight,
				});
		}
		return result;
	}
}
