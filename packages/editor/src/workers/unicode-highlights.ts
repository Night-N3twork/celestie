import type { UnicodeHighlightOptions } from "../api/unicode-highlights";
import { asciiConfusables } from "./unicode-confusables";
export interface UnicodeHighlight {
	readonly from: number;
	readonly to: number;
	readonly message: string;
}
export function unicodeHighlights(
	text: string,
	options: UnicodeHighlightOptions = {},
): UnicodeHighlight[] {
	const allowed = new Set(options.allowedCharacters ?? []);
	const locales = new Set(
		(options.allowedLocales ?? []).map(
			(locale) => new Intl.Locale(locale).language,
		),
	);
	const allowedScript = (char: string) =>
		(/\p{Script=Greek}/u.test(char) && locales.has("el")) ||
		(/\p{Script=Cyrillic}/u.test(char) &&
			["ru", "uk", "bg", "mk", "sr", "be"].some((locale) =>
				locales.has(locale),
			)) ||
		(/\p{Script=Latin}/u.test(char) &&
			["en", "fr", "de", "es", "pt", "it", "tr", "vi"].some((locale) =>
				locales.has(locale),
			));
	const values: UnicodeHighlight[] = [];
	for (const match of (options.invisibleCharacters === false
		? ""
		: text
	).matchAll(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: meow
		// biome-ignore lint/suspicious/noMisleadingCharacterClass: meow
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u034f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2028\u2029\ufeff]/g,
	)) {
		if (values.length >= 1000) break;
		if (allowed.has(match[0])) continue;
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
	if (options.ambiguousCharacters !== "off")
		for (const word of text.matchAll(/[\p{ID_Continue}$]+/gu)) {
			if (values.length >= 1000) break;
			if (
				options.ambiguousCharacters !== "all" &&
				!/[A-Za-z]/.test(word[0])
			)
				continue;
			let at = word.index;
			for (const char of word[0]) {
				const replacement = asciiConfusables.get(
					char.codePointAt(0) ?? 0,
				);
				if (
					values.length < 1000 &&
					replacement &&
					!allowed.has(char) &&
					!allowedScript(char)
				)
					values.push({
						from: at,
						to: at + char.length,
						message: `Identifier character resembles ASCII "${replacement}".`,
					});
				at += char.length;
			}
		}
	return values.sort((a, b) => a.from - b.from);
}
