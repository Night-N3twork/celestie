import type { DiffResult } from "../api/diff";

function span(
	value: unknown,
	length: number,
): value is { from: number; to: number } {
	return (
		!!value &&
		typeof value === "object" &&
		"from" in value &&
		"to" in value &&
		typeof value.from === "number" &&
		typeof value.to === "number" &&
		Number.isInteger(value.from) &&
		Number.isInteger(value.to) &&
		value.from >= 0 &&
		value.to >= value.from &&
		value.to <= length
	);
}
export function validDiffResult(
	value: unknown,
	originalLength: number,
	modifiedLength: number,
): value is DiffResult {
	if (
		!value ||
		typeof value !== "object" ||
		!("changes" in value) ||
		!Array.isArray(value.changes) ||
		value.changes.length > 5000 ||
		!("identical" in value) ||
		typeof value.identical !== "boolean" ||
		value.identical !== (value.changes.length === 0) ||
		!("quitEarly" in value) ||
		typeof value.quitEarly !== "boolean" ||
		("reason" in value &&
			!["size", "time", "work", "changes"].includes(String(value.reason)))
	)
		return false;
	let oldEnd = 0,
		newEnd = 0,
		oldLine = 0,
		newLine = 0,
		characters = 0;
	for (const change of value.changes) {
		if (
			!change ||
			typeof change !== "object" ||
			!span(change.original, originalLength) ||
			!span(change.modified, modifiedLength) ||
			!Array.isArray(change.characters) ||
			change.original.from < oldEnd ||
			change.modified.from < newEnd
		)
			return false;
		for (const key of [
			"originalStart",
			"originalEnd",
			"modifiedStart",
			"modifiedEnd",
		] as const)
			if (!Number.isInteger(change[key]) || change[key] < 0) return false;
		if (
			change.originalStart < oldLine ||
			change.modifiedStart < newLine ||
			change.originalEnd < change.originalStart ||
			change.modifiedEnd < change.modifiedStart ||
			change.originalEnd > originalLength + 1 ||
			change.modifiedEnd > modifiedLength + 1
		)
			return false;
		oldEnd = change.original.to;
		newEnd = change.modified.to;
		oldLine = change.originalEnd;
		newLine = change.modifiedEnd;
		let a = change.original.from,
			b = change.modified.from;
		for (const item of change.characters) {
			if (
				++characters > 150000 ||
				!item ||
				!span(item.original, oldEnd) ||
				!span(item.modified, newEnd) ||
				item.original.from < a ||
				item.modified.from < b
			)
				return false;
			a = item.original.to;
			b = item.modified.to;
		}
	}
	if ("moves" in value) {
		if (!Array.isArray(value.moves) || value.moves.length > 1000)
			return false;
		const ids = new Set<number>();
		for (const move of value.moves) {
			if (
				!move ||
				!Number.isInteger(move.id) ||
				move.id < 1 ||
				ids.has(move.id) ||
				!span(move.original, originalLength) ||
				!span(move.modified, modifiedLength)
			)
				return false;
			ids.add(move.id);
			for (const key of [
				"originalStart",
				"originalEnd",
				"modifiedStart",
				"modifiedEnd",
			] as const)
				if (!Number.isInteger(move[key]) || move[key] < 0) return false;
			if (
				move.originalEnd <= move.originalStart ||
				move.modifiedEnd <= move.modifiedStart ||
				move.originalEnd - move.originalStart !==
					move.modifiedEnd - move.modifiedStart ||
				move.originalEnd > originalLength + 1 ||
				move.modifiedEnd > modifiedLength + 1
			)
				return false;
		}
	}
	return true;
}
