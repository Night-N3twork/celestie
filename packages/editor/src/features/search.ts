import type { Range } from "../api/types";
import { TextBuffer } from "../model/text-buffer";

export interface SearchMatch {
	readonly from: number;
	readonly to: number;
	readonly range: Range;
}

export function findLiteralMatches(
	text: string,
	query: string,
	limit = 10000,
): {
	matches: readonly SearchMatch[];
	truncated: boolean;
} {
	if (!query) return { matches: [], truncated: false };
	const buffer = new TextBuffer(text);
	const matches: SearchMatch[] = [];
	let from = text.indexOf(query);
	while (from !== -1 && matches.length < limit) {
		const to = from + query.length;
		const start = buffer.getPositionAt(from);
		const end = buffer.getPositionAt(to);
		matches.push({
			from,
			to,
			range: {
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
		});
		from = text.indexOf(query, to);
	}
	return { matches, truncated: from !== -1 };
}
