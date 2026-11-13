import type {
	DiffChange,
	DiffComputationOptions,
	DiffResult,
} from "../api/diff";
import { movedBlocks } from "./moved-blocks";
import { computationOptions } from "./options";
import { anchoredEdits } from "./patience";

type Edit = { a: number; b: number; deleteCount: number; insertCount: number };
class Budget {
	work = 0;
	reason: DiffResult["reason"];
	constructor(
		private readonly limit: number,
		private readonly deadline: number,
	) {}
	step(count = 1): boolean {
		this.work += count;
		if (this.work > this.limit) {
			this.reason = "work";
			return false;
		}
		if ((this.work & 255) === 0 && performance.now() > this.deadline) {
			this.reason = "time";
			return false;
		}
		return true;
	}
}
function edits(
	a: readonly string[],
	b: readonly string[],
	budget: Budget,
): Edit[] | undefined {
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		if (!budget.step()) return;
		prefix++;
	}
	let endA = a.length,
		endB = b.length;
	while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
		if (!budget.step()) return;
		endA--;
		endB--;
	}
	const n = endA - prefix,
		m = endB - prefix;
	if (!n && !m) return [];
	if (!n || !m)
		return [{ a: prefix, b: prefix, deleteCount: n, insertCount: m }];
	const maximum = Math.min(n + m, 1024),
		offset = maximum + 1;
	const v = new Int32Array(2 * maximum + 3);
	v.fill(-1);
	v[offset + 1] = 0;
	const trace: Int32Array[] = [];
	for (let d = 0; d <= maximum; d++) {
		for (let k = -d; k <= d; k += 2) {
			if (!budget.step()) return;
			const slot = offset + k;
			let x =
				k === -d ||
				(k !== d && (v[slot - 1] ?? -1) < (v[slot + 1] ?? -1))
					? (v[slot + 1] ?? 0)
					: (v[slot - 1] ?? 0) + 1;
			let y = x - k;
			while (x < n && y < m && a[prefix + x] === b[prefix + y]) {
				if (!budget.step()) return;
				x++;
				y++;
			}
			v[slot] = x;
			if (x >= n && y >= m) {
				const operations: ("insert" | "delete" | "equal")[] = [];
				let px = n,
					py = m;
				for (let distance = d; distance > 0; distance--) {
					const previous = trace[distance - 1];
					if (!previous) return;
					const diagonal = px - py,
						previousK =
							diagonal === -distance ||
							(diagonal !== distance &&
								(previous[offset + diagonal - 1] ?? -1) <
									(previous[offset + diagonal + 1] ?? -1))
								? diagonal + 1
								: diagonal - 1,
						nextX = previous[offset + previousK] ?? 0,
						nextY = nextX - previousK;
					while (px > nextX && py > nextY) {
						operations.push("equal");
						px--;
						py--;
					}
					if (px === nextX) {
						operations.push("insert");
						py--;
					} else {
						operations.push("delete");
						px--;
					}
				}
				while (px > 0 && py > 0) {
					operations.push("equal");
					px--;
					py--;
				}
				operations.reverse();
				const result: Edit[] = [];
				let ai = prefix,
					bi = prefix,
					current: Edit | undefined;
				for (const operation of operations) {
					if (operation === "equal") {
						current = undefined;
						ai++;
						bi++;
					} else {
						if (!current) {
							current = {
								a: ai,
								b: bi,
								deleteCount: 0,
								insertCount: 0,
							};
							result.push(current);
						}
						if (operation === "delete") {
							current.deleteCount++;
							ai++;
						} else {
							current.insertCount++;
							bi++;
						}
					}
				}
				return result;
			}
		}
		trace.push(v.slice());
	}
	budget.reason = "work";
	return;
}
function starts(lines: readonly string[]): number[] {
	const values = [0];
	for (const line of lines)
		values.push((values.at(-1) ?? 0) + line.length + 1);
	values[lines.length] = Math.max(0, (values.at(-1) ?? 1) - 1);
	return values;
}
function lineCount(text: string): number {
	let count = 1;
	for (let i = 0; i < text.length; i++)
		if (text.charCodeAt(i) === 10) count++;
	return count;
}
function coarse(
	original: string,
	modified: string,
	reason: NonNullable<DiffResult["reason"]>,
): DiffResult {
	return {
		identical: original === modified,
		quitEarly: true,
		reason,
		changes:
			original === modified
				? []
				: [
						{
							originalStart: 0,
							originalEnd: lineCount(original),
							modifiedStart: 0,
							modifiedEnd: lineCount(modified),
							original: { from: 0, to: original.length },
							modified: { from: 0, to: modified.length },
							characters: [],
						},
					],
	};
}
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function calculateDiff(
	original: string,
	modified: string,
	options: DiffComputationOptions = {},
): DiffResult {
	const config = computationOptions(options),
		budget = new Budget(
			config.maxWork,
			performance.now() + config.maxComputationTimeMs,
		);
	if (original === modified)
		return { changes: [], identical: true, quitEarly: false };
	if (Math.max(original.length, modified.length) > config.maxFileSize)
		return coarse(original, modified, "size");
	const a = original.split("\n"),
		b = modified.split("\n");
	if (Math.max(a.length, b.length) > config.maxLines)
		return coarse(original, modified, "size");
	const compare = (lines: string[]) =>
		config.ignoreTrimWhitespace ? lines.map((line) => line.trim()) : lines;
	const changes = anchoredEdits(compare(a), compare(b), budget, edits);
	if (!changes) return coarse(original, modified, budget.reason ?? "work");
	if (changes.length > 5000) return coarse(original, modified, "changes");
	const ao = starts(a),
		bo = starts(b),
		result: DiffChange[] = [];
	for (const change of changes) {
		const originalEnd = change.a + change.deleteCount,
			modifiedEnd = change.b + change.insertCount;
		let af = ao[change.a] ?? original.length,
			bf = bo[change.b] ?? modified.length;
		if (originalEnd === a.length && modifiedEnd === b.length) {
			if (change.a < a.length && original[af - 1] === "\n") af--;
			if (change.b < b.length && modified[bf - 1] === "\n") bf--;
		}
		const originalRange = {
				from: af,
				to: ao[originalEnd] ?? original.length,
			},
			modifiedRange = {
				from: bf,
				to: bo[modifiedEnd] ?? modified.length,
			};
		const characters: DiffChange["characters"][number][] = [];
		const oldText = original.slice(originalRange.from, originalRange.to),
			newText = modified.slice(modifiedRange.from, modifiedRange.to);
		if (oldText.length + newText.length > 20_000 && !budget.reason)
			budget.reason = "size";
		if (oldText.length + newText.length <= 20_000 && !budget.reason) {
			const ac = Array.from(segmenter.segment(oldText)),
				bc = Array.from(segmenter.segment(newText));
			const characterEdits = edits(
				ac.map((unit) => unit.segment),
				bc.map((unit) => unit.segment),
				budget,
			);
			for (const item of characterEdits ?? [])
				characters.push({
					original: {
						from: af + (ac[item.a]?.index ?? oldText.length),
						to:
							af +
							(ac[item.a + item.deleteCount]?.index ??
								oldText.length),
					},
					modified: {
						from: bf + (bc[item.b]?.index ?? newText.length),
						to:
							bf +
							(bc[item.b + item.insertCount]?.index ??
								newText.length),
					},
				});
		}
		result.push({
			originalStart: change.a,
			originalEnd,
			modifiedStart: change.b,
			modifiedEnd,
			original: originalRange,
			modified: modifiedRange,
			characters,
		});
	}
	const moves =
		config.detectMoves && !budget.reason
			? movedBlocks(a, b, result, budget)
			: [];
	return {
		moves,
		changes: result,
		identical: result.length === 0,
		quitEarly: !!budget.reason,
		...(budget.reason ? { reason: budget.reason } : {}),
	};
}
