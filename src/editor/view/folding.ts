import type { TextEdit } from "../core/document";
import { displayOffset, displayText, documentOffset } from "./textInput";

export interface FoldRange {
	from: number;
	to: number;
}
interface Segment {
	from: number;
	to: number;
	start: number;
	end: number;
	folded: boolean;
}

export class FoldProjection {
	readonly text: string;
	readonly segments: Segment[] = [];
	constructor(
		readonly source: string,
		folds: readonly FoldRange[],
	) {
		const pieces: string[] = [];
		let cursor = 0;
		let length = 0;
		const add = (from: number, to: number, folded: boolean) => {
			const text = folded ? "…\n" : displayText(source.slice(from, to));
			this.segments.push({
				from,
				to,
				start: length,
				end: length + text.length,
				folded,
			});
			pieces.push(text);
			length += text.length;
		};
		for (const fold of [...folds].sort((a, b) => a.from - b.from)) {
			if (
				fold.from < cursor ||
				fold.to <= fold.from ||
				fold.to > source.length
			)
				continue;
			add(cursor, fold.from, false);
			add(fold.from, fold.to, true);
			cursor = fold.to;
		}
		add(cursor, source.length, false);
		this.text = pieces.join("");
	}
	toDocument(offset: number, bias: "left" | "right" = "right"): number {
		for (const segment of this.segments) {
			if (offset > segment.end) continue;
			if (!segment.folded)
				return (
					segment.from +
					documentOffset(
						this.source.slice(segment.from, segment.to),
						Math.max(0, offset - segment.start),
					)
				);
			if (offset === segment.start) return segment.from;
			if (offset === segment.end) return segment.to;
			return bias === "left" ? segment.from : segment.to;
		}
		return this.source.length;
	}
	toView(offset: number): number {
		for (const segment of this.segments) {
			if (offset > segment.to) continue;
			return segment.folded
				? offset <= segment.from
					? segment.start
					: segment.end
				: segment.start +
						displayOffset(
							this.source.slice(segment.from, segment.to),
							Math.max(0, offset - segment.from),
						);
		}
		return this.text.length;
	}
	foldAt(offset: number): FoldRange | undefined {
		const segment = this.segments.find(
			(segment) =>
				segment.folded &&
				offset >= segment.start &&
				offset < segment.end,
		);
		return segment ? { from: segment.from, to: segment.to } : undefined;
	}
}

export function rebaseFolds(
	folds: readonly FoldRange[],
	edit: TextEdit,
): FoldRange[] {
	const delta = edit.text.length - (edit.to - edit.from);
	return folds.flatMap((fold) =>
		edit.to <= fold.from
			? [{ from: fold.from + delta, to: fold.to + delta }]
			: edit.from >= fold.to
				? [fold]
				: [],
	);
}

export function sourceDifference(
	before: string,
	after: string,
): TextEdit | undefined {
	if (before === after) return;
	let from = 0;
	while (
		from < before.length &&
		from < after.length &&
		before[from] === after[from]
	)
		from++;
	let to = before.length,
		end = after.length;
	while (to > from && end > from && before[to - 1] === after[end - 1]) {
		to--;
		end--;
	}
	return { from, to, text: after.slice(from, end) };
}
