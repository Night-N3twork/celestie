export interface UnicodeHighlightOptions {
	readonly invisibleCharacters?: boolean;
	readonly ambiguousCharacters?: "mixed" | "all" | "off";
	readonly allowedCharacters?: readonly string[];
	readonly allowedLocales?: readonly string[];
}
export function validateUnicodeHighlightOptions(
	options: UnicodeHighlightOptions,
): void {
	if (
		!options ||
		typeof options !== "object" ||
		(options.invisibleCharacters !== undefined &&
			typeof options.invisibleCharacters !== "boolean") ||
		(options.ambiguousCharacters !== undefined &&
			!["mixed", "all", "off"].includes(options.ambiguousCharacters))
	)
		throw new TypeError("Invalid unicode highlight policy.");
	if (
		options.allowedCharacters &&
		(!Array.isArray(options.allowedCharacters) ||
			options.allowedCharacters.length > 10000 ||
			options.allowedCharacters.some(
				(char) => typeof char !== "string" || [...char].length !== 1,
			))
	)
		throw new TypeError(
			"Allowed unicode characters must be individual code points.",
		);
	if (options.allowedLocales) {
		if (
			!Array.isArray(options.allowedLocales) ||
			options.allowedLocales.length > 100
		)
			throw new TypeError("Invalid allowed locales.");
		for (const locale of options.allowedLocales) {
			if (typeof locale !== "string")
				throw new TypeError("Invalid locale.");
			new Intl.Locale(locale);
		}
	}
}
