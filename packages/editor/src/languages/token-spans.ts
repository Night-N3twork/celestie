import type { Token } from "../api/languages";

export function validateTokens(
	tokens: readonly Token[],
	length: number,
): Token[] {
	if (!Array.isArray(tokens) || tokens.length > 150000)
		throw new RangeError("Token output exceeds the supported limit.");
	let end = 0;
	return tokens.map((token) => {
		if (
			!token ||
			!Number.isInteger(token.from) ||
			!Number.isInteger(token.to) ||
			token.from < end ||
			token.to <= token.from ||
			token.to > length ||
			typeof token.kind !== "string" ||
			!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(token.kind)
		)
			throw new TypeError(
				"Tokens must have valid scopes and sorted, non-overlapping UTF-16 ranges.",
			);
		end = token.to;
		return { from: token.from, to: token.to, kind: token.kind };
	});
}

export function mergeTokenLayers(
	lexical: readonly Token[],
	semantic: readonly Token[],
): Token[] {
	if (!semantic.length) return [...lexical];
	const result: Token[] = [];
	let index = 0,
		from = lexical[0]?.from ?? 0;
	for (const overlay of semantic) {
		while (index < lexical.length) {
			const token = lexical[index];
			if (!token || token.from >= overlay.to) break;
			if (from < overlay.from)
				result.push({
					...token,
					from,
					to: Math.min(token.to, overlay.from),
				});
			if (token.to > overlay.to) {
				from = overlay.to;
				break;
			}
			index++;
			from = lexical[index]?.from ?? 0;
		}
		result.push({ ...overlay });
	}
	for (; index < lexical.length; index++) {
		const token = lexical[index];
		if (token) result.push({ ...token, from });
		from = lexical[index + 1]?.from ?? 0;
	}
	return result;
}
