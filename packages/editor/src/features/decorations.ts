import type { Diagnostic } from "../api/languages";
import type { Disposable, Range } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
export interface Decoration {
	readonly range: Range;
	readonly className?: string;
	readonly background?: string;
	readonly underline?: string;
	readonly gutter?: string;
	readonly hover?: string;
	readonly overview?: string;
}
export interface VisibleDecoration extends Decoration {
	readonly id: string;
}
export class DecorationCollection implements Disposable {
	private disposed = false;
	private entries: { range: TrackedRange; options: Decoration }[] = [];
	constructor(
		private readonly model: TextModel,
		private readonly changed: () => void,
		private readonly released: () => void = () => {},
	) {}
	set(decorations: readonly Decoration[]): void {
		if (this.disposed) throw new Error("Decoration collection disposed.");
		const prepared = decorations.map((value) => {
			if (value.className && !/^[a-zA-Z][\w-]*$/.test(value.className))
				throw new TypeError("Invalid decoration class.");
			return value;
		});
		const next: { range: TrackedRange; options: Decoration }[] = [];
		try {
			for (const options of prepared)
				next.push({
					range: this.model.trackRange(options.range),
					options: { ...options },
				});
		} catch (error) {
			for (const entry of next) entry.range.dispose();
			throw error;
		}
		for (const entry of this.entries) entry.range.dispose();
		this.entries = next;
		this.changed();
	}
	get(): readonly VisibleDecoration[] {
		return this.entries.flatMap((entry) => {
			const range = entry.range.getRange();
			return range
				? [{ ...entry.options, range, id: entry.range.id }]
				: [];
		});
	}
	clear(): void {
		for (const entry of this.entries) entry.range.dispose();
		this.entries = [];
		this.changed();
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
		this.released();
	}
}
export function diagnosticDecorations(
	model: TextModel,
	diagnostics: readonly Diagnostic[],
): Decoration[] {
	return diagnostics
		.filter(
			(item) =>
				Number.isInteger(item.from) &&
				Number.isInteger(item.to) &&
				item.from >= 0 &&
				item.to >= item.from,
		)
		.map((item) => {
			const start = model.getPositionAtInputOffset(item.from),
				end = model.getPositionAtInputOffset(item.to);
			const color =
				item.severity === "error"
					? "var(--editor-error)"
					: item.severity === "warning"
						? "var(--editor-warning)"
						: "var(--editor-accent)";
			return {
				range: {
					startLine: start.line,
					startColumn: start.column,
					endLine: end.line,
					endColumn: end.column,
				},
				underline: color,
				gutter: item.severity === "error" ? "●" : "▲",
				hover: item.message,
				overview: color,
			};
		});
}
