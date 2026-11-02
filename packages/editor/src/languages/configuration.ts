export type CharacterPair = readonly [open: string, close: string];

export interface LanguageConfiguration {
	readonly brackets: readonly CharacterPair[];
	readonly quotes: readonly string[];
	readonly lineComment?: string;
	readonly blockComment?: CharacterPair;
	readonly templateQuote?: string;
	readonly regexLiterals?: boolean;
}

export function resolveLanguageConfiguration(
	configuration: LanguageConfiguration,
): LanguageConfiguration {
	const characters = configuration.brackets
		.flat()
		.concat([...configuration.quotes]);
	if (
		characters.some((character) => character.length !== 1) ||
		new Set(characters).size !== characters.length
	)
		throw new Error(
			"Bracket and quote rules must use distinct single UTF-16 characters.",
		);
	if (
		configuration.lineComment === "" ||
		configuration.blockComment?.some((marker) => !marker)
	)
		throw new Error("Comment delimiters must not be empty.");
	if (
		configuration.templateQuote &&
		!configuration.quotes.includes(configuration.templateQuote)
	)
		throw new Error(
			"The template quote must also be registered as a quote.",
		);
	return Object.freeze({
		...configuration,
		brackets: Object.freeze(
			configuration.brackets.map(([open, close]) =>
				Object.freeze([open, close] as const),
			),
		),
		quotes: Object.freeze([...configuration.quotes]),
		...(configuration.blockComment
			? {
					blockComment: Object.freeze([
						...configuration.blockComment,
					] as [string, string]),
				}
			: {}),
	});
}

export const plainTextConfiguration: LanguageConfiguration = {
	brackets: [
		["(", ")"],
		["[", "]"],
		["{", "}"],
	],
	quotes: ['"', "'"],
};

export const typescriptConfiguration: LanguageConfiguration = {
	...plainTextConfiguration,
	quotes: ['"', "'", "`"],
	lineComment: "//",
	blockComment: ["/*", "*/"],
	templateQuote: "`",
	regexLiterals: true,
};
