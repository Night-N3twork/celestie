export interface UnicodeHighlight {
	readonly from: number;
	readonly to: number;
	readonly message: string;
}
export function unicodeHighlights(text: string): UnicodeHighlight[] {
	const values: UnicodeHighlight[] = [];
	for (const match of text.matchAll(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: meow
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/g,
	)) {
		if (values.length >= 1000) break;
		const code = (match[0].codePointAt(0) ?? 0)
			.toString(16)
			.toUpperCase()
			.padStart(4, "0");
		values.push({
			from: match.index,
			to: match.index + match[0].length,
			message: `Invisible, directional or unusual line-separator character U+${code}.`,
		});
	}
	for (const word of text.matchAll(/[\p{ID_Continue}$]+/gu)) {
		if (values.length >= 1000) break;
		if (!/[A-Za-z]/.test(word[0])) continue;
		for (const char of word[0].matchAll(
			/[\u0391\u0392\u0395\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7\u03bf\u03c1\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0430\u0435\u043e\u0440\u0441\u0445\u0456]/g,
		)) {
			if (values.length >= 1000) break;
			values.push({
				from: word.index + char.index,
				to: word.index + char.index + 1,
				message:
					"Mixed-script identifier contains a character resembling an ASCII letter.",
			});
		}
	}
	return values.sort((a, b) => a.from - b.from);
}
