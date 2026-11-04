import type { EditorOptions } from "../api/editor-options";
import type { TextModel } from "../model/text-model";
export interface FoldRegion {
	readonly start: number;
	readonly end: number;
	readonly collapsed: boolean;
}
export interface VisualRow {
	readonly index: number;
	readonly line: number;
	readonly from: number;
	readonly to: number;
	readonly indent: number;
	readonly kind?: "zone";
}
interface Segment {
	from: number;
	to: number;
	indent: number;
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function wrapLine(
	text: string,
	width: number,
	measure: (text: string) => number,
	tabSize: number,
	indentMode: EditorOptions["wrapIndent"],
	extra: (offset: number) => number = () => 0,
): Segment[] {
	if (!Number.isFinite(width) || width <= 0)
		return [{ from: 0, to: text.length, indent: 0 }];
	const space = measure(" ") || 8,
		tab = space * tabSize;
	const leading = text.match(/^[\t ]*/)?.[0] ?? "";
	let indentation = 0;
	for (const unit of leading)
		indentation =
			unit === "\t"
				? (Math.floor(indentation / tab) + 1) * tab
				: indentation + space;
	const continuation = Math.min(
		width / 2,
		indentMode === "none"
			? 0
			: indentation + (indentMode === "indent" ? tab : 0),
	);
	const units = Array.from(graphemes.segment(text));
	const rows: Segment[] = [];
	let first = 0;
	while (first < units.length) {
		const from = units[first]?.index ?? 0,
			indent = rows.length ? continuation : 0;
		let used = 0,
			lastBreak = -1,
			next = first;
		for (; next < units.length; next++) {
			const unit = units[next];
			if (!unit) break;
			const added = extra(unit.index);
			const advance =
				unit.segment === "\t"
					? tab - (used % tab)
					: measure(unit.segment);
			if (next > first && used + added + advance + indent > width) break;
			used += added + advance;
			if (/\s/u.test(unit.segment)) lastBreak = next + 1;
		}
		if (next < units.length && lastBreak > first) next = lastBreak;
		next = Math.max(first + 1, next);
		const to = units[next]?.index ?? text.length;
		rows.push({ from, to, indent });
		first = next;
	}
	return rows.length ? rows : [{ from: 0, to: 0, indent: 0 }];
}
export class VisualLayout {
	private counts: number[] = [];
	private starts: number[] = [];
	private segments = new Map<number, Segment[]>();
	private key = "";
	private total = 0;
	private zones = new Set<number>();
	private hintWidths = new Map<number, number>();
	private wrapCache = new Map<string, Segment[]>();
	invalidate(): void {
		this.key = "";
		this.wrapCache.clear();
	}
	private width = Infinity;
	private options: EditorOptions | undefined;
	constructor(
		private readonly model: () => TextModel,
		private readonly measure: (text: string) => number,
	) {}
	update(
		options: EditorOptions,
		viewportWidth: number,
		folds: readonly FoldRegion[],
		accessible: boolean,
		zoneLines: readonly number[] = [],
		hints: readonly { offset: number; text: string }[] = [],
	): boolean {
		const model = this.model();
		const width =
			accessible || options.wordWrap === "off"
				? Infinity
				: options.wordWrap === "wordWrapColumn"
					? options.wordWrapColumn * this.measure(" ")
					: options.wordWrap === "bounded"
						? Math.min(
								viewportWidth,
								options.wordWrapColumn * this.measure(" "),
							)
						: viewportWidth;
		const key = `${model.id}:${model.getVersionId()}:${width}:${options.tabSize}:${options.wrapIndent}:${options.fontFamily}:${options.fontSize}:${accessible}:${JSON.stringify(folds)}:${zoneLines.join(",")}:${JSON.stringify(hints)}`;
		if (key === this.key) return false;
		this.key = key;
		this.zones = new Set(zoneLines);
		this.hintWidths = new Map(
			hints.map((hint) => [
				hint.offset,
				this.measure(hint.text) * 0.8 + 6,
			]),
		);
		this.width = width;
		this.options = options;
		this.starts = [];
		this.counts = [];
		this.segments.clear();
		this.total = 0;
		const hidden = accessible
			? []
			: folds
					.filter((fold) => fold.collapsed)
					.sort((a, b) => a.start - b.start);
		let cursor = 0,
			hiddenThrough = 0;
		for (let line = 1; line <= model.getLineCount(); line++) {
			while (
				hidden[cursor] &&
				(hidden[cursor]?.start ?? Infinity) < line
			) {
				hiddenThrough = Math.max(
					hiddenThrough,
					hidden[cursor]?.end ?? 0,
				);
				cursor++;
			}
			this.starts.push(this.total);
			const count =
				line <= hiddenThrough
					? 0
					: Number.isFinite(width)
						? this.getSegments(line).length
						: 1;
			this.counts.push(count + (count && this.zones.has(line) ? 1 : 0));
			this.total += count + (count && this.zones.has(line) ? 1 : 0);
		}
		return true;
	}
	get rowCount(): number {
		return this.total;
	}
	getSegments(line: number): Segment[] {
		let segments = this.segments.get(line);
		if (!segments) {
			const text = this.model().getLineContent(line),
				base = this.model().getInputOffsetAt({ line, column: 1 }),
				withHints = [...this.hintWidths.keys()].some(
					(offset) => offset >= base && offset <= base + text.length,
				),
				key = `${this.width}:${this.options?.tabSize}:${this.options?.wrapIndent}:${this.options?.fontFamily}:${this.options?.fontSize}:${text}`;
			segments = withHints ? undefined : this.wrapCache.get(key);
			if (!segments) {
				segments = wrapLine(
					text,
					this.width,
					this.measure,
					this.options?.tabSize ?? 4,
					this.options?.wrapIndent ?? "none",
					(column) => this.hintWidths.get(base + column) ?? 0,
				);
				if (!withHints && text.length < 10000) {
					if (this.wrapCache.size >= 10000) this.wrapCache.clear();
					this.wrapCache.set(key, segments);
				}
			}
			this.segments.set(line, segments);
		}
		return segments;
	}

	row(index: number): VisualRow {
		index = Math.max(0, Math.min(this.total - 1, index));
		let low = 0,
			high = this.starts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if ((this.starts[mid] ?? 0) <= index) low = mid;
			else high = mid - 1;
		}
		while (low > 0 && !this.counts[low]) low--;
		if (this.zones.has(low + 1) && index === this.starts[low])
			return {
				index,
				line: low + 1,
				from: 0,
				to: 0,
				indent: 0,
				kind: "zone",
			};
		const segment = this.getSegments(low + 1)[
			index - (this.starts[low] ?? 0) - (this.zones.has(low + 1) ? 1 : 0)
		] ?? { from: 0, to: 0, indent: 0 };
		return { index, line: low + 1, ...segment };
	}
	position(
		line: number,
		column: number,
		affinity: "before" | "after" = "after",
	): VisualRow {
		line = Math.max(1, Math.min(this.starts.length, line));
		while (line > 1 && !this.counts[line - 1]) line--;
		const segments = this.getSegments(line);
		let index = segments.findIndex((segment) =>
			affinity === "before"
				? column - 1 <= segment.to
				: column - 1 < segment.to,
		);
		if (index < 0) index = segments.length - 1;
		return {
			index:
				(this.starts[line - 1] ?? 0) +
				Math.max(0, index) +
				(this.zones.has(line) ? 1 : 0),
			line,
			...(segments[Math.max(0, index)] ?? { from: 0, to: 0, indent: 0 }),
		};
	}
}
