import type {
	ContentChange,
	InputMappingSegment,
	ModelChangeEvent,
} from "../api/types";
import type { TextBuffer } from "./text-buffer";

export type Affinity = "before" | "after";

export function mapModelInputOffset(
	offset: number,
	event: ModelChangeEvent,
	affinity: Affinity,
): number {
	if (event.inputMappingBatches)
		return event.inputMappingBatches.reduce(
			(value, mapping) => mapInputOffset(value, mapping, affinity),
			offset,
		);
	return event.inputMappings
		? mapInputOffset(offset, event.inputMappings, affinity)
		: mapOffset(offset, event.inputChanges ?? [], affinity);
}

export function inputMappings(
	before: TextBuffer,
	after: TextBuffer,
	changes: readonly ContentChange[],
): readonly InputMappingSegment[] {
	const anchors = new Set([0, before.getNormalizedLength()]);
	const deltas: number[] = [];
	let delta = 0;
	for (const change of changes) {
		deltas.push(delta);
		delta += change.text.length - change.length;
		for (const raw of [change.offset, change.offset + change.length]) {
			const offset = before.getNormalizedOffset(raw);
			for (const value of [offset - 1, offset, offset + 1])
				if (value >= 0 && value <= before.getNormalizedLength())
					anchors.add(value);
		}
	}
	const map = (offset: number, affinity: Affinity): number => {
		const raw = before.getRawOffset(offset);
		let low = 0;
		let high = changes.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if ((changes[middle]?.offset ?? Infinity) <= raw) low = middle + 1;
			else high = middle;
		}
		const index = low - 1;
		const change = changes[index];
		if (!change) return after.getNormalizedOffset(raw);
		const start = change.offset + (deltas[index] ?? 0);
		const end = change.offset + change.length;
		const mapped =
			raw <= end
				? start +
					((change.length && raw === end) || affinity === "after"
						? change.text.length
						: 0)
				: raw +
					(deltas[index] ?? 0) +
					change.text.length -
					change.length;
		return after.getNormalizedOffset(mapped);
	};
	const sorted = [...anchors].sort((a, b) => a - b);
	return sorted.map((from, index) => ({
		from,
		before: map(from, "before"),
		after: map(from, "after"),
		slope:
			(sorted[index + 1] ?? from) > from + 1 &&
			map(from + 1, "after") > map(from, "after")
				? 1
				: 0,
	}));
}

export function mapInputOffset(
	offset: number,
	mappings: readonly InputMappingSegment[],
	affinity: Affinity = "after",
): number {
	let low = 0;
	let high = mappings.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((mappings[middle]?.from ?? Infinity) <= offset) low = middle + 1;
		else high = middle;
	}
	const segment = mappings[Math.max(0, low - 1)];
	return segment
		? segment[affinity] + (offset - segment.from) * segment.slope
		: offset;
}

export function mapOffset(
	offset: number,
	changes: readonly ContentChange[],
	affinity: Affinity = "after",
): number {
	let delta = 0;
	for (const change of changes) {
		if (offset < change.offset) break;
		const end = change.offset + change.length;
		if (offset <= end) {
			if (change.length && offset === end) {
				delta += change.text.length - change.length;
				continue;
			}
			return (
				change.offset +
				delta +
				(affinity === "after" ? change.text.length : 0)
			);
		}
		delta += change.text.length - change.length;
	}
	return offset + delta;
}

interface Piece {
	from: number;
	length: number;
	text?: string;
}

export function composeChanges(
	length: number,
	batches: readonly (readonly ContentChange[])[],
): readonly ContentChange[] {
	let pieces: Piece[] = length ? [{ from: 0, length }] : [];
	const part = (from: number, to: number): Piece[] => {
		const result: Piece[] = [];
		let offset = 0;
		for (const piece of pieces) {
			const start = Math.max(0, from - offset);
			const end = Math.min(piece.length, to - offset);
			if (start < end)
				result.push(
					piece.text !== undefined
						? {
								from: 0,
								length: end - start,
								text: piece.text.slice(start, end),
							}
						: { from: piece.from + start, length: end - start },
				);
			offset += piece.length;
			if (offset >= to) break;
		}
		return result;
	};
	let currentLength = length;
	for (const changes of batches)
		for (let index = changes.length - 1; index >= 0; index--) {
			const change = changes[index];
			if (!change) continue;
			const next = [
				...part(0, change.offset),
				...(change.text
					? [
							{
								from: 0,
								length: change.text.length,
								text: change.text,
							},
						]
					: []),
				...part(change.offset + change.length, currentLength),
			];
			pieces = [];
			for (const piece of next) {
				const previous = pieces.at(-1);
				if (
					previous &&
					previous.text === undefined &&
					piece.text === undefined &&
					previous.from + previous.length === piece.from
				)
					previous.length += piece.length;
				else if (
					previous?.text !== undefined &&
					piece.text !== undefined &&
					previous.length + piece.length <= 4096
				) {
					previous.text += piece.text;
					previous.length += piece.length;
				} else pieces.push({ ...piece });
			}
			currentLength += change.text.length - change.length;
		}
	const changes: ContentChange[] = [];
	let cursor = 0;
	let inserted: string[] = [];
	for (const piece of pieces) {
		if (piece.text !== undefined) {
			inserted.push(piece.text);
			continue;
		}
		if (piece.from > cursor || inserted.length)
			changes.push({
				offset: cursor,
				length: piece.from - cursor,
				text: inserted.join(""),
			});
		inserted = [];
		cursor = piece.from + piece.length;
	}
	if (cursor < length || inserted.length)
		changes.push({
			offset: cursor,
			length: length - cursor,
			text: inserted.join(""),
		});
	return changes;
}

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");

export function inputChanges(
	buffer: TextBuffer,
	changes: readonly ContentChange[],
): readonly ContentChange[] {
	const groups: { from: number; to: number; changes: ContentChange[] }[] = [];
	for (const change of changes) {
		let from = Math.max(0, change.offset - 1);
		let to = Math.min(
			buffer.getLength(),
			change.offset + change.length + 1,
		);
		if (buffer.charAt(from - 1) === "\r" && buffer.charAt(from) === "\n")
			from--;
		if (buffer.charAt(to - 1) === "\r" && buffer.charAt(to) === "\n") to++;
		const previous = groups.at(-1);
		if (previous && from <= previous.to) {
			previous.to = Math.max(previous.to, to);
			previous.changes.push(change);
		} else groups.push({ from, to, changes: [change] });
	}
	const result: ContentChange[] = [];
	for (const group of groups) {
		const before = normalize(buffer.slice(group.from, group.to));
		let cursor = group.from;
		const parts: string[] = [];
		for (const change of group.changes) {
			parts.push(buffer.slice(cursor, change.offset), change.text);
			cursor = change.offset + change.length;
		}
		parts.push(buffer.slice(cursor, group.to));
		const after = normalize(parts.join(""));
		let start = 0;
		let oldEnd = before.length;
		let newEnd = after.length;
		while (
			start < oldEnd &&
			start < newEnd &&
			before[start] === after[start]
		)
			start++;
		while (
			oldEnd > start &&
			newEnd > start &&
			before[oldEnd - 1] === after[newEnd - 1]
		) {
			oldEnd--;
			newEnd--;
		}
		if (start !== oldEnd || start !== newEnd)
			result.push({
				offset: buffer.getNormalizedOffset(group.from) + start,
				length: oldEnd - start,
				text: after.slice(start, newEnd),
			});
	}
	return result;
}
