import type { DiffChange, DiffMove } from "../api/diff";

interface Budget {
	step(count?: number): boolean;
}
export function movedBlocks(
	a: readonly string[],
	b: readonly string[],
	changes: readonly DiffChange[],
	budget: Budget,
): DiffMove[] {
	const key = (lines: readonly string[], from: number, to: number) => {
		if (to - from < 2 && (lines[from]?.trim().length ?? 0) < 20) return;
		let hash = 2166136261,
			nonempty = false;
		for (let i = from; i < to; i++) {
			const text = lines[i] ?? "";
			nonempty ||= !!text.trim();
			for (let c = 0; c < text.length; c++) {
				if ((c & 63) === 0 && !budget.step()) return;
				hash = Math.imul(hash ^ text.charCodeAt(c), 16777619);
			}
			hash = Math.imul(hash ^ 10, 16777619);
		}
		return nonempty ? `${to - from}:${hash >>> 0}` : undefined;
	};
	const deleted = new Map<string, DiffChange | null>(),
		inserted = new Map<string, DiffChange | null>();
	for (const change of changes) {
		const old = key(a, change.originalStart, change.originalEnd),
			next = key(b, change.modifiedStart, change.modifiedEnd);
		if (old) deleted.set(old, deleted.has(old) ? null : change);
		if (next) inserted.set(next, inserted.has(next) ? null : change);
	}
	const result: DiffMove[] = [];
	for (const [hash, old] of deleted) {
		const next = inserted.get(hash);
		if (!old || !next || old.originalStart === next.modifiedStart) continue;
		let equal = true;
		for (let i = 0; i < old.originalEnd - old.originalStart; i++) {
			if (!budget.step()) return result;
			if (a[old.originalStart + i] !== b[next.modifiedStart + i]) {
				equal = false;
				break;
			}
		}
		if (equal)
			result.push({
				id: result.length + 1,
				originalStart: old.originalStart,
				originalEnd: old.originalEnd,
				modifiedStart: next.modifiedStart,
				modifiedEnd: next.modifiedEnd,
				original: old.original,
				modified: next.modified,
			});
		if (result.length >= 1000) break;
	}
	const oldFlags = new Uint8Array(a.length),
		newFlags = new Uint8Array(b.length);
	for (const change of changes) {
		oldFlags.fill(1, change.originalStart, change.originalEnd);
		newFlags.fill(1, change.modifiedStart, change.modifiedEnd);
	}
	for (const move of result) {
		oldFlags.fill(2, move.originalStart, move.originalEnd);
		newFlags.fill(2, move.modifiedStart, move.modifiedEnd);
	}
	const unique = (lines: readonly string[], flags: Uint8Array) => {
		const map = new Map<string, number>();
		for (let i = 0; i < lines.length; i++)
			if (flags[i] === 1 && lines[i]?.trim()) {
				if (!budget.step()) break;
				const text = lines[i] ?? "";
				map.set(text, map.has(text) ? -1 : i);
			}
		return map;
	};
	const oldUnique = unique(a, oldFlags),
		newUnique = unique(b, newFlags);
	const offsets = (lines: readonly string[]) => {
		let at = 0;
		return [
			...lines.map((line) => {
				const start = at;
				at += line.length + 1;
				return start;
			}),
			Math.max(0, at - 1),
		];
	};
	const ao = offsets(a),
		bo = offsets(b);
	for (const [text, oldLine] of oldUnique) {
		const newLine = newUnique.get(text);
		if (
			oldLine < 0 ||
			newLine === undefined ||
			newLine < 0 ||
			oldLine === newLine ||
			oldFlags[oldLine] !== 1 ||
			newFlags[newLine] !== 1
		)
			continue;
		let af = oldLine,
			bf = newLine,
			ae = oldLine + 1,
			be = newLine + 1;
		while (
			af > 0 &&
			bf > 0 &&
			oldFlags[af - 1] === 1 &&
			newFlags[bf - 1] === 1 &&
			a[af - 1] === b[bf - 1]
		) {
			if (!budget.step()) return result;
			af--;
			bf--;
		}
		while (
			ae < a.length &&
			be < b.length &&
			oldFlags[ae] === 1 &&
			newFlags[be] === 1 &&
			a[ae] === b[be]
		) {
			if (!budget.step()) return result;
			ae++;
			be++;
		}
		if (ae - af < 2 && text.trim().length < 20) continue;
		oldFlags.fill(2, af, ae);
		newFlags.fill(2, bf, be);
		result.push({
			id: result.length + 1,
			originalStart: af,
			originalEnd: ae,
			modifiedStart: bf,
			modifiedEnd: be,
			original: { from: ao[af] ?? 0, to: ao[ae] ?? 0 },
			modified: { from: bo[bf] ?? 0, to: bo[be] ?? 0 },
		});
		if (result.length >= 1000) break;
	}
	return result;
}
