import type { Range } from "../api/types";
import { TextBuffer } from "../model/text-buffer";

export interface SearchMatch {
	readonly from: number;
	readonly to: number;
	readonly range: Range;
}

export interface SearchOptions {
	readonly matchCase?: boolean;
	readonly wholeWord?: boolean;
	readonly scope?: { readonly from: number; readonly to: number };
}

const wordCharacter = /[\p{ID_Continue}$]/u;

function characterBefore(text: string, offset: number): string {
	const last = text.charCodeAt(offset - 1);
	return text.slice(
		offset - (last >= 0xdc00 && last <= 0xdfff ? 2 : 1),
		offset,
	);
}

export function findLiteralMatches(
	text: string,
	query: string,
	options: SearchOptions = {},
	limit = 10000,
): {
	matches: readonly SearchMatch[];
	truncated: boolean;
} {
	if (!query) return { matches: [], truncated: false };
	const buffer = new TextBuffer(text);
	const matches: SearchMatch[] = [];
	const pattern = new RegExp(
		query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		options.matchCase === false ? "giu" : "gu",
	);
	const scope = options.scope ?? { from: 0, to: text.length };
	pattern.lastIndex = scope.from;
	let truncated = false;
	for (let hit = pattern.exec(text); hit; hit = pattern.exec(text)) {
		const from = hit.index;
		const to = from + hit[0].length;
		if (from < scope.from) continue;
		if (to > scope.to) break;
		if (
			options.wholeWord &&
			(wordCharacter.test(characterBefore(text, from)) ||
				wordCharacter.test(
					String.fromCodePoint(text.codePointAt(to) ?? 32),
				))
		)
			continue;
		if (matches.length >= limit) {
			truncated = true;
			break;
		}
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
	}
	return { matches, truncated };
}
