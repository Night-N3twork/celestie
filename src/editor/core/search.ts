import type { TextEdit } from "./document";

export interface SearchOptions {
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
}

export interface SearchMatch {
	readonly from: number;
	readonly to: number;
}

const wordCharacter = /[\p{L}\p{N}\p{M}\p{Pc}$\u200c\u200d]/u;

function characterBefore(text: string, offset: number): string {
	const last = text.charCodeAt(offset - 1);
	return text.slice(
		offset - (last >= 0xdc00 && last <= 0xdfff ? 2 : 1),
		offset,
	);
}

export function findMatches(
	text: string,
	query: string,
	options: SearchOptions,
): SearchMatch[] {
	if (!query) return [];
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const expression = new RegExp(escaped, options.matchCase ? "gu" : "giu");
	const matches: SearchMatch[] = [];
	for (const match of text.matchAll(expression)) {
		const from = match.index;
		const to = from + match[0].length;
		if (
			options.wholeWord &&
			((from > 0 && wordCharacter.test(characterBefore(text, from))) ||
				(to < text.length &&
					wordCharacter.test(
						String.fromCodePoint(text.codePointAt(to) ?? 0),
					)))
		)
			continue;
		matches.push({ from, to });
	}
	return matches;
}

export function nextMatch(
	matches: readonly SearchMatch[],
	offset: number,
	backwards = false,
	inclusive = true,
): SearchMatch | undefined {
	if (backwards) {
		for (let index = matches.length - 1; index >= 0; index--) {
			const match = matches[index];
			if (inclusive ? match.from <= offset : match.from < offset)
				return match;
		}
		return matches.at(-1);
	}
	return (
		matches.find((match) =>
			inclusive ? match.from >= offset : match.from > offset,
		) ?? matches[0]
	);
}

export function replaceMatches(
	text: string,
	matches: readonly SearchMatch[],
	replacement: string,
): TextEdit | undefined {
	const first = matches[0];
	const last = matches.at(-1);
	if (!first || !last) return;
	const pieces: string[] = [];
	let cursor = first.from;
	for (const match of matches) {
		pieces.push(text.slice(cursor, match.from), replacement);
		cursor = match.to;
	}
	return { from: first.from, to: last.to, text: pieces.join("") };
}
