export const defaultWordPattern = /[\p{ID_Continue}$\u200c\u200d]+/gu;

export function isWholeWord(
	text: string,
	from: number,
	to: number,
	pattern: RegExp = defaultWordPattern,
): boolean {
	const lineStart = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
	const newline = text.indexOf("\n", to);
	const lineEnd = newline === -1 ? text.length : newline;
	const expression = new RegExp(
		pattern.source,
		`${pattern.flags.replace(/[gy]/g, "")}g`,
	);
	for (const match of text.slice(lineStart, lineEnd).matchAll(expression)) {
		const start = lineStart + match.index,
			end = start + match[0].length;
		if (end <= from || !match[0]) continue;
		if (start >= to) break;
		if (start < from || end > to) return false;
	}
	return true;
}
