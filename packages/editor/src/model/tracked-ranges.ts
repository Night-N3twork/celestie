import type { ContentChange, Disposable, Range } from "../api/types";
import { mapOffset } from "./change-mapping";
import type { TextBuffer } from "./text-buffer";

export type RangeStickiness = "always" | "never" | "before" | "after";
export interface TrackedRangeOptions {
	readonly stickiness?: RangeStickiness;
}
export interface TrackedRange extends Disposable {
	readonly id: string;
	getRange(): Range | null;
	setRange(range: Range): void;
}
interface Entry {
	from: number;
	to: number;
	readonly stickiness: RangeStickiness;
	valid: boolean;
}

export class TrackedRanges {
	private readonly entries = new Map<string, Entry>();
	private sequence = 0;
	add(
		buffer: TextBuffer,
		range: Range,
		options: TrackedRangeOptions,
	): string {
		const stickiness = options.stickiness ?? "never";
		if (!["always", "never", "before", "after"].includes(stickiness))
			throw new Error("Unknown range stickiness.");
		const offsets = buffer.getOffsets(range);
		const id = `range-${++this.sequence}`;
		this.entries.set(id, { ...offsets, stickiness, valid: true });
		return id;
	}
	get(buffer: TextBuffer, id: string): Range | null {
		const entry = this.entries.get(id);
		if (!entry?.valid) return null;
		const start = buffer.getPositionAt(entry.from);
		const end = buffer.getPositionAt(entry.to);
		return {
			startLine: start.line,
			startColumn: start.column,
			endLine: end.line,
			endColumn: end.column,
		};
	}
	set(buffer: TextBuffer, id: string, range: Range): void {
		const entry = this.entries.get(id);
		if (!entry) throw new Error("Tracked range disposed.");
		Object.assign(entry, buffer.getOffsets(range), { valid: true });
	}
	remove(id: string): void {
		this.entries.delete(id);
	}
	map(changes: readonly ContentChange[]): void {
		for (const entry of this.entries.values()) {
			if (!entry.valid) continue;
			const from = mapOffset(
				entry.from,
				changes,
				entry.stickiness === "always" || entry.stickiness === "before"
					? "before"
					: "after",
			);
			const to = mapOffset(
				entry.to,
				changes,
				entry.stickiness === "always" || entry.stickiness === "after"
					? "after"
					: "before",
			);
			entry.from = from;
			entry.to = Math.max(from, to);
		}
	}
	invalidate(): void {
		for (const entry of this.entries.values()) entry.valid = false;
	}
	clear(): void {
		this.entries.clear();
	}
}
