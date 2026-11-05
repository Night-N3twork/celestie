import type { LanguageDefinition } from "../api/languages";

function matchesGlob(path: string, pattern: string): boolean {
	let expression = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		if (pattern.slice(index, index + 3) === "**/") {
			expression += "(?:.*/)?";
			index += 2;
		} else if (char === "*") expression += "[^/]*";
		else if (char === "?") expression += "[^/]";
		else expression += char?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${expression}$`, "i").test(
		pattern.includes("/") ? path : (path.split("/").at(-1) ?? ""),
	);
}

export function matchLanguage(
	definitions: readonly LanguageDefinition[],
	path: string,
	firstLine: string,
): string {
	const normalized = path.replace(/\\/g, "/").toLowerCase();
	const filename = normalized.split("/").at(-1) ?? "";
	let extensionMatch = "plaintext",
		longest = 0;
	for (const language of definitions)
		if (language.filenames?.some((name) => name.toLowerCase() === filename))
			return language.id;
	for (const language of definitions)
		if (
			language.filenamePatterns?.some((pattern) =>
				matchesGlob(normalized, pattern),
			)
		)
			return language.id;
	for (const language of definitions)
		for (const extension of language.extensions)
			if (
				extension.length > longest &&
				normalized.endsWith(extension.toLowerCase())
			) {
				extensionMatch = language.id;
				longest = extension.length;
			}
	if (longest) return extensionMatch;
	for (const language of definitions)
		if (
			language.firstLine &&
			new RegExp(
				language.firstLine.source,
				language.firstLine.flags.replace(/[gy]/g, ""),
			).test(firstLine.slice(0, 1000))
		)
			return language.id;
	return "plaintext";
}
