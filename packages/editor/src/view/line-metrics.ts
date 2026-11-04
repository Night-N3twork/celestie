export const longLineLimit = 20000;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class LineMetrics {
	private readonly offsets = [0];
	private readonly widths = [0];
	readonly width: number;
	constructor(
		readonly text: string,
		private readonly measure: (text: string, initial: number) => number,
	) {
		let from = 0,
			width = 0;
		while (from < text.length) {
			let to = Math.min(text.length, from + 512);
			if (
				to < text.length &&
				!/^[\x20-\x7e\t]*$/.test(text.slice(from, to + 1))
			) {
				let boundary = from;
				while (boundary === from && to < text.length) {
					if (
						/^[\uD800-\uDBFF]$/.test(text[to - 1] ?? "") &&
						/^[\uDC00-\uDFFF]$/.test(text[to] ?? "")
					)
						to--;
					const units = segmenter.segment(text.slice(from, to));
					for (const unit of units) boundary = from + unit.index;
					if (boundary === from) to = Math.min(text.length, to + 512);
				}
				if (boundary > from) to = boundary;
			}
			width += measure(text.slice(from, to), width);
			this.offsets.push(to);
			this.widths.push(width);
			from = to;
		}
		this.width = width;
	}
	private checkpoint(values: readonly number[], value: number): number {
		let low = 0,
			high = values.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if ((values[mid] ?? 0) <= value) low = mid;
			else high = mid - 1;
		}
		return low;
	}
	xAt(offset: number): number {
		const index = this.checkpoint(this.offsets, offset),
			from = this.offsets[index] ?? 0,
			x = this.widths[index] ?? 0;
		return x + this.measure(this.text.slice(from, offset), x);
	}
	offsetAt(x: number): number {
		const index = this.checkpoint(this.widths, Math.max(0, x)),
			from = this.offsets[index] ?? 0,
			to = this.offsets[index + 1] ?? this.text.length;
		let offset = from,
			previous = this.widths[index] ?? 0;
		for (const unit of segmenter.segment(this.text.slice(from, to))) {
			const end = from + unit.index + unit.segment.length,
				next = this.xAt(end);
			if (x < (previous + next) / 2) return offset;
			offset = end;
			previous = next;
		}
		return offset;
	}
}
