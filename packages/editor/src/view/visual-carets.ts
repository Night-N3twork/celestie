import { hasRightToLeft } from "./text-shaping";
export interface VisualCaret {
	readonly offset: number;
	readonly affinity: "before" | "after";
	readonly x: number;
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function visualCarets(
	text: string,
	from: number,
	to: number,
	box: (from: number, to: number) => { left: number; right: number },
	collapsed: (offset: number, after: boolean) => number,
): VisualCaret[] {
	const result: VisualCaret[] = [];
	for (const unit of graphemes.segment(text.slice(from, to))) {
		const start = from + unit.index,
			end = start + unit.segment.length,
			rect = box(start, end),
			a = collapsed(start, true),
			b = collapsed(end, false);
		let rtl =
			hasRightToLeft(unit.segment) && !/^\p{N}+$/u.test(unit.segment);
		if (
			!/[\p{L}\p{N}]/u.test(unit.segment) &&
			a >= rect.left - 0.5 &&
			a <= rect.right + 0.5 &&
			b >= rect.left - 0.5 &&
			b <= rect.right + 0.5
		)
			rtl = a > b;
		result.push(
			{
				offset: start,
				affinity: "after",
				x: rtl ? rect.right : rect.left,
			},
			{
				offset: end,
				affinity: "before",
				x: rtl ? rect.left : rect.right,
			},
		);
	}
	if (!result.length)
		result.push({
			offset: from,
			affinity: "after",
			x: collapsed(from, true),
		});
	return result.sort((a, b) => a.x - b.x || a.offset - b.offset);
}
