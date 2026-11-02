import type { Range } from "../api/types";
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
			(wordCharacter.test(characterBefore(text, from)) ||
				wordCharacter.test(
					String.fromCodePoint(text.codePointAt(to) ?? 32),
				))
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

export function expandRegexReplacement(
	replacement: string,
	match: SearchMatch,
	source: string,
	budget = 16000000,
): string {
	let size = replacement.length;
	if (size > budget) throw new RangeError("Replacement is too large.");
	const captures = match.captures ?? [];
	const substitute = (
		original: string,
		token: string,
		name: string | undefined,
	): string => {
		if (token === "$") return "$";
		if (token === "&") return source.slice(match.from, match.to);
		if (token === "`") return source.slice(0, match.from);
		if (token === "'") return source.slice(match.to);
		if (name !== undefined)
			return match.groups ? (match.groups[name] ?? "") : original;
		const number = Number(token);
		if (number >= 1 && number <= captures.length)
			return captures[number - 1] ?? "";
		const first = Number(token[0]);
		if (token.length === 2 && first >= 1 && first <= captures.length)
			return (captures[first - 1] ?? "") + token[1];
		return original;
	};
	return replacement.replace(
		/\$(\$|&|`|'|<([^>]+)>|[0-9]{1,2})/g,
		(original: string, token: string, name: string | undefined): string => {
			const value = substitute(original, token, name);
			size += value.length - original.length;
			if (size > budget)
				throw new RangeError("Replacement is too large.");
			return value;
		},
	);
}
