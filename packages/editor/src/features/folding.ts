import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import type { FoldRegion } from "../view/visual-layout";
export interface FoldingRange {
	readonly start: number;
	readonly end: number;
}
export class FoldingState implements Disposable {
	private entries: { range: TrackedRange; collapsed: boolean }[] = [];
	constructor(private readonly model: TextModel) {}
	set(ranges: readonly FoldingRange[]): void {
		const old = new Map(
			this.get().map((range) => [range.start, range.collapsed]),
		);
		for (const entry of this.entries) entry.range.dispose();
		this.entries = [];
		const seen = new Set<number>();
		for (const range of ranges
			.slice()
			.sort((a, b) => a.start - b.start || b.end - a.end)) {
			if (
				seen.has(range.start) ||
				!Number.isInteger(range.start) ||
				!Number.isInteger(range.end) ||
				range.end <= range.start ||
				range.start < 1 ||
				range.end > this.model.getLineCount()
			)
				continue;
			seen.add(range.start);
			this.entries.push({
				range: this.model.trackRange({
					startLine: range.start,
					startColumn: 1,
					endLine: range.end,
					endColumn: this.model.getLineMaxColumn(range.end),
				}),
				collapsed: old.get(range.start) ?? false,
			});
		}
	}
	get(): FoldRegion[] {
		return this.entries.flatMap((entry) => {
			const range = entry.range.getRange();
			return range && range.endLine > range.startLine
				? [
						{
							start: range.startLine,
							end: range.endLine,
							collapsed: entry.collapsed,
						},
					]
				: [];
		});
	}
	toggle(line: number): void {
		const match = this.entries.find(
			(entry) => entry.range.getRange()?.startLine === line,
		);
		if (match) match.collapsed = !match.collapsed;
	}
	reveal(line: number): boolean {
		let changed = false;
		for (const entry of this.entries) {
			const range = entry.range.getRange();
			if (
				entry.collapsed &&
				range &&
				line > range.startLine &&
				line <= range.endLine
			) {
				entry.collapsed = false;
				changed = true;
			}
		}
		return changed;
	}
	all(collapsed: boolean): void {
		for (const entry of this.entries) entry.collapsed = collapsed;
	}
	dispose(): void {
		for (const entry of this.entries) entry.range.dispose();
		this.entries = [];
	}
}
