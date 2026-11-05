import type { EditorOptions } from "../api/editor-options";
import type { TextModel } from "../model/text-model";
import { longLineLimit } from "./line-metrics";
import { needsShapedMeasurement } from "./text-shaping";
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
	readonly zone?: string;
	readonly zoneRow?: number;
}
export interface LayoutZone {
	readonly id: string;
	readonly line: number;
	readonly placement: "before" | "after";
	readonly rows: number;
}
interface LineZones {
	readonly before: LayoutZone[];
	readonly after: LayoutZone[];
	beforeRows: number;
	afterRows: number;
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
	ligatures = false,
): Segment[] {
	if (!Number.isFinite(width) || width <= 0 || text.length > longLineLimit)
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
	const advances = units.map((unit) =>
		unit.segment === "\t" ? 0 : measure(unit.segment),
	);
	if (needsShapedMeasurement(text, ligatures))
		shapeAdvances(text, units, advances, measure);
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
					: (advances[next] ?? 0);
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
function shapeAdvances(
	text: string,
	units: readonly Intl.SegmentData[],
	advances: number[],
	measure: (text: string) => number,
): void {
	let first = 0;
	while (first < units.length) {
		if (/\s/u.test(units[first]?.segment ?? " ")) {
			first++;
			continue;
		}
		let last = first;
		while (
			last + 1 < units.length &&
			!/\s/u.test(units[last + 1]?.segment ?? " ")
		)
			last++;
		if (last > first) {
			const from = units[first]?.index ?? 0,
				to =
					(units[last]?.index ?? 0) +
					(units[last]?.segment.length ?? 0),
				shaped = measure(text.slice(from, to));
			let isolated = 0;
			for (let index = first; index <= last; index++)
				isolated += advances[index] ?? 0;
			if (isolated > 0 && shaped > 0)
				for (let index = first; index <= last; index++)
					advances[index] =
						((advances[index] ?? 0) * shaped) / isolated;
		}
		first = last + 1;
	}
}
export class VisualLayout {
	private counts: number[] = [];
	private starts: number[] = [];
	private segments = new Map<number, Segment[]>();
	private key = "";
	private total = 0;
	private uniform = false;
	private zones = new Map<number, LineZones>();
	private zoneLines = new Map<string, number>();
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
		zones: readonly LayoutZone[] = [],
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
		const key = `${model.id}:${model.getVersionId()}:${width}:${options.tabSize}:${options.wrapIndent}:${options.fontFamily}:${options.fontSize}:${options.fontLigatures}:${accessible}:${JSON.stringify(folds)}:${zones.map((zone) => `${zone.id}@${zone.line}${zone.placement}${zone.rows}`).join(",")}:${JSON.stringify(hints)}`;
		if (key === this.key) return false;
		this.key = key;
		this.zones = new Map();
		this.zoneLines = new Map();
		for (const zone of zones) {
			this.zoneLines.set(zone.id, zone.line);
			const rows = Math.max(1, Math.floor(zone.rows));
			let entry = this.zones.get(zone.line);
			if (!entry) {
				entry = { before: [], after: [], beforeRows: 0, afterRows: 0 };
				this.zones.set(zone.line, entry);
			}
			entry[zone.placement].push({ ...zone, rows });
			if (zone.placement === "before") entry.beforeRows += rows;
			else entry.afterRows += rows;
		}
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
		this.uniform =
			!Number.isFinite(width) && !hidden.length && !this.zones.size;
		if (this.uniform) {
			this.total = model.getLineCount();
			return true;
		}
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
			const entry = this.zones.get(line),
				rows = count
					? count + (entry ? entry.beforeRows + entry.afterRows : 0)
					: 0;
			this.counts.push(rows);
			this.total += rows;
		}
		return true;
	}
	zoneStart(id: string): number | undefined {
		const line = this.zoneLines.get(id),
			entry = line === undefined ? undefined : this.zones.get(line);
		if (line === undefined || !entry || !this.counts[line - 1])
			return undefined;
		let start = this.starts[line - 1] ?? 0;
		for (const zone of entry.before) {
			if (zone.id === id) return start;
			start += zone.rows;
		}
		start += this.getSegments(line).length;
		for (const zone of entry.after) {
			if (zone.id === id) return start;
			start += zone.rows;
		}
		return undefined;
	}
	get rowCount(): number {
		return this.total;
	}
	getSegments(line: number): Segment[] {
		let segments = this.segments.get(line);
		if (!segments) {
			const text = this.model().getLineContent(line);
			if (!Number.isFinite(this.width) || text.length > longLineLimit) {
				segments = [{ from: 0, to: text.length, indent: 0 }];
				this.segments.set(line, segments);
				return segments;
			}
			const base = this.model().getInputOffsetAt({ line, column: 1 }),
				withHints =
					text.length <= longLineLimit &&
					[...this.hintWidths.keys()].some(
						(offset) =>
							offset >= base && offset <= base + text.length,
					),
				key = `${this.width}:${this.options?.tabSize}:${this.options?.wrapIndent}:${this.options?.fontFamily}:${this.options?.fontSize}:${this.options?.fontLigatures}:${text}`;
			segments = withHints ? undefined : this.wrapCache.get(key);
			if (!segments) {
				segments = wrapLine(
					text,
					this.width,
					this.measure,
					this.options?.tabSize ?? 4,
					this.options?.wrapIndent ?? "none",
					(column) => this.hintWidths.get(base + column) ?? 0,
					this.options?.fontLigatures !== false,
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
		if (this.uniform)
			return {
				index,
				line: index + 1,
				...(this.getSegments(index + 1)[0] ?? {
					from: 0,
					to: 0,
					indent: 0,
				}),
			};
		let low = 0,
			high = this.starts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if ((this.starts[mid] ?? 0) <= index) low = mid;
			else high = mid - 1;
		}
		while (low > 0 && !this.counts[low]) low--;
		const line = low + 1,
			entry = this.zones.get(line),
			local = index - (this.starts[low] ?? 0);
		if (entry && local < entry.beforeRows)
			return zoneRow(entry.before, index, line, local);
		const segments = this.getSegments(line),
			segmentIndex = local - (entry?.beforeRows ?? 0);
		if (entry && segmentIndex >= segments.length)
			return zoneRow(
				entry.after,
				index,
				line,
				segmentIndex - segments.length,
			);
		const segment = segments[segmentIndex] ?? {
			from: 0,
			to: 0,
			indent: 0,
		};
		return { index, line, ...segment };
	}
	position(
		line: number,
		column: number,
		affinity: "before" | "after" = "after",
	): VisualRow {
		if (this.uniform) {
			line = Math.max(1, Math.min(this.total, line));
			return {
				index: line - 1,
				line,
				...(this.getSegments(line)[0] ?? { from: 0, to: 0, indent: 0 }),
			};
		}
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
				(this.zones.get(line)?.beforeRows ?? 0),
			line,
			...(segments[Math.max(0, index)] ?? { from: 0, to: 0, indent: 0 }),
		};
	}
}
function zoneRow(
	zones: readonly LayoutZone[],
	index: number,
	line: number,
	local: number,
): VisualRow {
	let start = 0;
	for (const zone of zones) {
		if (local < start + zone.rows)
			return {
				index,
				line,
				from: 0,
				to: 0,
				indent: 0,
				kind: "zone",
				zone: zone.id,
				zoneRow: local - start,
			};
		start += zone.rows;
	}
	return { index, line, from: 0, to: 0, indent: 0, kind: "zone" };
}
