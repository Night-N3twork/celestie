export interface LineEdit {
	a: number;
	b: number;
	deleteCount: number;
	insertCount: number;
}
interface Budget {
	step(count?: number): boolean;
}
type Basic<T extends Budget> = (
	a: readonly string[],
	b: readonly string[],
	budget: T,
) => LineEdit[] | undefined;
export function anchoredEdits<T extends Budget>(
	a: readonly string[],
	b: readonly string[],
	budget: T,
	basic: Basic<T>,
): LineEdit[] | undefined {
	let first = 0,
		endA = a.length,
		endB = b.length;
	while (first < endA && first < endB && a[first] === b[first]) {
		if (!budget.step()) return;
		first++;
	}
	while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
		if (!budget.step()) return;
		endA--;
		endB--;
	}
	const aa = a.slice(first, endA),
		bb = b.slice(first, endB);
	const shift = (items: LineEdit[], a: number, b: number) =>
		items.map((item) => ({ ...item, a: item.a + a, b: item.b + b }));
	if (aa.length + bb.length < 2048) {
		const found = basic(aa, bb, budget);
		return found && shift(found, first, first);
	}
	const unique = (lines: readonly string[]) => {
		const map = new Map<string, number>();
		for (let i = 0; i < lines.length; i++) {
			if (!budget.step()) return;
			const key = lines[i] ?? "";
			map.set(key, map.has(key) ? -1 : i);
		}
		return map;
	};
	const old = unique(aa),
		next = unique(bb);
	if (!old || !next) return;
	const candidates: { a: number; b: number; previous: number }[] = [],
		tails: number[] = [];
	for (const [key, at] of old) {
		const target = next.get(key);
		if (at < 0 || target === undefined || target < 0) continue;
		let low = 0,
			high = tails.length;
		while (low < high) {
			if (!budget.step()) return;
			const mid = (low + high) >>> 1;
			if ((candidates[tails[mid] ?? 0]?.b ?? 0) < target) low = mid + 1;
			else high = mid;
		}
		candidates.push({ a: at, b: target, previous: tails[low - 1] ?? -1 });
		tails[low] = candidates.length - 1;
	}
	const anchors: { a: number; b: number }[] = [];
	for (let at = tails.at(-1) ?? -1; at >= 0; ) {
		const item = candidates[at];
		if (!item) break;
		anchors.push(item);
		at = item.previous;
	}
	anchors.reverse();
	anchors.push({ a: aa.length, b: bb.length });
	let fromA = 0,
		fromB = 0;
	const result: LineEdit[] = [];
	for (const anchor of anchors) {
		const found = basic(
			aa.slice(fromA, anchor.a),
			bb.slice(fromB, anchor.b),
			budget,
		);
		if (!found) return;
		for (const item of shift(found, first + fromA, first + fromB)) {
			const previous = result.at(-1);
			if (
				previous &&
				previous.a + previous.deleteCount === item.a &&
				previous.b + previous.insertCount === item.b
			) {
				previous.deleteCount += item.deleteCount;
				previous.insertCount += item.insertCount;
			} else result.push(item);
		}
		fromA = anchor.a + 1;
		fromB = anchor.b + 1;
	}
	return result;
}
