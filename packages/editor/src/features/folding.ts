import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import type { FoldRegion } from "../view/visual-layout";
export interface FoldingRange {
	readonly start: number;
	readonly end: number;
}
interface FoldEntry {
	readonly range: TrackedRange;
	collapsed: boolean;
}
function crosses(a: FoldingRange, b: FoldingRange): boolean {
	return (
		(a.start < b.start && a.end >= b.start && a.end < b.end) ||
		(b.start < a.start && b.end >= a.start && b.end < a.end)
	);
}
export class FoldingState implements Disposable {
	private automatic: FoldEntry[] = [];
	private manual: FoldEntry[] = [];
	constructor(private readonly model: TextModel) {}
	private value(entry: FoldEntry): FoldRegion | undefined {
		const range = entry.range.getRange();
		return range && range.endLine > range.startLine
			? {
					start: range.startLine,
					end: range.endLine,
					collapsed: entry.collapsed,
				}
			: undefined;
	}
	private visible(): { entry: FoldEntry; value: FoldRegion }[] {
		const manual = this.manual.flatMap((entry) => {
			const value = this.value(entry);
			return value ? [{ entry, value }] : [];
		});
		const candidates = [
			...manual,
			...this.automatic.flatMap((entry) => {
				const value = this.value(entry);
				return value &&
					!manual.some(
						(item) =>
							item.value.start === value.start ||
							crosses(item.value, value),
					)
					? [{ entry, value }]
					: [];
			}),
		].sort(
			(a, b) =>
				a.value.start - b.value.start || b.value.end - a.value.end,
		);
		const stack: FoldRegion[] = [],
			result: { entry: FoldEntry; value: FoldRegion }[] = [];
		for (const candidate of candidates) {
			while (
				stack.length &&
				(stack.at(-1)?.end ?? 0) < candidate.value.start
			)
				stack.pop();
			if (
				(stack.at(-1)?.end ?? Infinity) < candidate.value.end ||
				result.at(-1)?.value.start === candidate.value.start
			)
				continue;
			result.push(candidate);
			stack.push(candidate.value);
		}
		return result;
	}
	private valid(range: FoldingRange): boolean {
		return (
			Number.isInteger(range.start) &&
			Number.isInteger(range.end) &&
			range.start >= 1 &&
			range.end > range.start &&
			range.end <= this.model.getLineCount()
		);
	}
	private track(range: FoldingRange, collapsed: boolean): FoldEntry {
		return {
			range: this.model.trackRange({
				startLine: range.start,
				startColumn: 1,
				endLine: range.end,
				endColumn: this.model.getLineMaxColumn(range.end),
			}),
			collapsed,
		};
	}
	set(ranges: readonly FoldingRange[]): void {
		const old = new Map(
			this.automatic.flatMap((entry) => {
				const value = this.value(entry);
				return value ? [[value.start, value.collapsed] as const] : [];
			}),
		);
		for (const entry of this.automatic) entry.range.dispose();
		const seen = new Set<number>();
		this.automatic = [...ranges]
			.filter((range) => this.valid(range))
			.sort((a, b) => a.start - b.start || b.end - a.end)
			.flatMap((range) => {
				if (seen.has(range.start)) return [];
				seen.add(range.start);
				return [this.track(range, old.get(range.start) ?? false)];
			});
	}
	get(): FoldRegion[] {
		return this.visible().map(({ value }) => value);
	}
	add(start: number, end: number): void {
		const range = { start, end };
		if (!this.valid(range))
			throw new RangeError(
				"A fold needs valid inclusive start/end lines.",
			);
		if (
			this.manual.some((entry) => {
				const value = this.value(entry);
				return value && value.start !== start && crosses(value, range);
			})
		)
			throw new Error(
				"Manual folding ranges must be nested or disjoint.",
			);
		this.remove(start);
		this.manual.push(this.track(range, true));
	}
	remove(line: number): void {
		this.manual = this.manual.filter((entry) => {
			if (entry.range.getRange()?.startLine !== line) return true;
			entry.range.dispose();
			return false;
		});
	}
	setCollapsed(line: number, collapsed: boolean, recursive = false): void {
		const entries = this.visible(),
			parent = entries.find(({ value }) => value.start === line)?.value;
		if (!parent) return;
		for (const { entry, value } of entries)
			if (
				value.start === line ||
				(recursive &&
					value.start >= parent.start &&
					value.end <= parent.end)
			)
				entry.collapsed = collapsed;
	}
	level(level: number): void {
		if (!Number.isInteger(level) || level < 1)
			throw new RangeError("Fold level must be a positive integer.");
		const stack: number[] = [];
		for (const { entry, value } of this.visible()) {
			while (stack.length && (stack.at(-1) ?? 0) < value.start)
				stack.pop();
			entry.collapsed = stack.length + 1 === level;
			stack.push(value.end);
		}
	}
	toggle(line: number): void {
		const match = this.visible().find(({ value }) => value.start === line);
		if (match) match.entry.collapsed = !match.entry.collapsed;
	}
	reveal(line: number): boolean {
		let changed = false;
		for (const { entry, value } of this.visible())
			if (entry.collapsed && line > value.start && line <= value.end) {
				entry.collapsed = false;
				changed = true;
			}
		return changed;
	}
	all(collapsed: boolean): void {
		for (const entry of [...this.automatic, ...this.manual])
			entry.collapsed = collapsed;
	}
	dispose(): void {
		for (const entry of [...this.automatic, ...this.manual])
			entry.range.dispose();
		this.automatic = [];
		this.manual = [];
	}
}
