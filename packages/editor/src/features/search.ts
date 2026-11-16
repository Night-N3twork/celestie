import type { Range } from "../api/types";
import { isWholeWord } from "../languages/word-pattern";
import { TextBuffer } from "../model/text-buffer";

export interface SearchMatch {
	readonly from: number;
	readonly to: number;
	readonly range: Range;
	readonly captures?: readonly (string | undefined)[];
	readonly groups?: Readonly<Record<string, string | undefined>>;
}

export interface SearchOptions {
	readonly matchCase?: boolean;
	readonly wholeWord?: boolean;
	readonly scope?: { readonly from: number; readonly to: number };
	readonly wordPattern?: RegExp;
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
	const pattern = new RegExp(
		query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		options.matchCase === false ? "giu" : "gu",
	);
	return findPatternMatches(text, pattern, options, limit);
}

export function findPatternMatches(
	text: string,
	pattern: RegExp,
	options: SearchOptions,
	limit = 10000,
	capture = false,
): { matches: readonly SearchMatch[]; truncated: boolean } {
	const buffer = new TextBuffer(text);
	const matches: SearchMatch[] = [];
	let payloadSize = 0;
	const scope = options.scope ?? { from: 0, to: text.length };
	pattern.lastIndex = scope.from;
	let truncated = false;
	for (let hit = pattern.exec(text); hit; hit = pattern.exec(text)) {
		const from = hit.index;
		const to = from + hit[0].length;
		if (from === to)
			pattern.lastIndex =
				from + ((text.codePointAt(from) ?? 0) > 0xffff ? 2 : 1);
		if (from < scope.from) continue;
		if (to > scope.to) break;
		if (
			options.wholeWord &&
			!isWholeWord(text, from, to, options.wordPattern)
		)
			continue;
		payloadSize += hit.reduce(
			(size, value) => size + (value?.length ?? 0),
			0,
		);
		if (matches.length >= limit || (capture && payloadSize > 2000000)) {
			truncated = true;
			break;
		}
		const start = buffer.getPositionAt(from);
		const end = buffer.getPositionAt(to);
		matches.push({
			from,
			to,
			...(capture
				? {
						captures: hit.slice(1),
						...(hit.groups ? { groups: { ...hit.groups } } : {}),
					}
				: {}),
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

export { expandRegexReplacement } from "./replacement-text";
