import { getLanguage } from "../api/languages";
import { defaultWordPattern } from "./word-pattern";
export type CharacterPair = readonly [open: string, close: string];
export type ScopeExclusion = "string" | "comment";
export type IndentAction = "none" | "indent" | "indentOutdent" | "outdent";

export interface AutoClosingPair {
	readonly open: string;
	readonly close: string;
	readonly notIn?: readonly ScopeExclusion[];
}

export interface IndentationRules {
	readonly increaseIndentPattern: RegExp;
	readonly decreaseIndentPattern: RegExp;
	readonly indentNextLinePattern?: RegExp;
	readonly unIndentedLinePattern?: RegExp;
}

export interface OnEnterRule {
	readonly beforeText: RegExp;
	readonly afterText?: RegExp;
	readonly previousLineText?: RegExp;
	readonly action: {
		readonly indent: IndentAction;
		readonly appendText?: string;
		readonly removeText?: number;
	};
}

export interface FoldingRules {
	readonly offSide?: boolean;
	readonly markers?: { readonly start: RegExp; readonly end: RegExp };
}

export interface LanguageConfiguration {
	readonly brackets: readonly CharacterPair[];
	readonly quotes: readonly string[];
	readonly lineComment?: string;
	readonly blockComment?: CharacterPair;
	readonly templateQuote?: string;
	readonly regexLiterals?: boolean;
	readonly autoClosingPairs?: readonly AutoClosingPair[];
	readonly autoCloseBefore?: string;
	readonly surroundingPairs?: readonly CharacterPair[];
	readonly wordPattern?: RegExp;
	readonly indentationRules?: IndentationRules;
	readonly onEnterRules?: readonly OnEnterRule[];
	readonly folding?: FoldingRules;
	readonly colorizedBracketPairs?: readonly CharacterPair[];
}

function plain(pattern: RegExp, name: string): RegExp {
	if (!(pattern instanceof RegExp))
		throw new TypeError(`${name} must be a regular expression.`);
	return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
}

export { defaultWordPattern } from "./word-pattern";

const wordExpressions = new WeakMap<RegExp, RegExp>();

export function wordExpression(configuration: LanguageConfiguration): RegExp {
	const pattern = configuration.wordPattern;
	if (!pattern) return defaultWordPattern;
	let expression = wordExpressions.get(pattern);
	if (!expression) {
		expression = new RegExp(
			pattern.source,
			`${pattern.flags.replace(/[gy]/g, "")}g`,
		);
		wordExpressions.set(pattern, expression);
	}
	return expression;
}

export function isWord(
	configuration: LanguageConfiguration,
	text: string,
): boolean {
	if (!text) return false;
	for (const match of text.matchAll(wordExpression(configuration)))
		return match.index === 0 && match[0].length === text.length;
	return false;
}

export function resolveLanguageConfiguration(
	configuration: LanguageConfiguration,
): LanguageConfiguration {
	if (
		configuration.autoClosingPairs?.some(
			(pair) =>
				!pair.open ||
				!pair.close ||
				pair.notIn?.some(
					(scope) => scope !== "string" && scope !== "comment",
				),
		) ||
		configuration.surroundingPairs?.some(([open, close]) => !open || !close)
	)
		throw new Error(
			"Auto-closing and surrounding pairs need non-empty delimiters; notIn accepts string or comment.",
		);
	if (
		configuration.onEnterRules?.some(
			(rule) =>
				!["none", "indent", "indentOutdent", "outdent"].includes(
					rule.action.indent,
				) ||
				(rule.action.removeText !== undefined &&
					!(
						Number.isInteger(rule.action.removeText) &&
						rule.action.removeText >= 0
					)),
		)
	)
		throw new Error(
			"On-enter rules need a known indent action and a non-negative integer removeText.",
		);
	if (
		configuration.wordPattern &&
		plain(configuration.wordPattern, "wordPattern").test("")
	)
		throw new Error("The word pattern must not match empty text.");
	const rules = configuration.indentationRules;
	const markers = configuration.folding?.markers;
	const normalized: Partial<LanguageConfiguration> = {
		...(configuration.wordPattern
			? { wordPattern: plain(configuration.wordPattern, "wordPattern") }
			: {}),
		...(rules
			? {
					indentationRules: Object.freeze({
						increaseIndentPattern: plain(
							rules.increaseIndentPattern,
							"increaseIndentPattern",
						),
						decreaseIndentPattern: plain(
							rules.decreaseIndentPattern,
							"decreaseIndentPattern",
						),
						...(rules.indentNextLinePattern
							? {
									indentNextLinePattern: plain(
										rules.indentNextLinePattern,
										"indentNextLinePattern",
									),
								}
							: {}),
						...(rules.unIndentedLinePattern
							? {
									unIndentedLinePattern: plain(
										rules.unIndentedLinePattern,
										"unIndentedLinePattern",
									),
								}
							: {}),
					}),
				}
			: {}),
		...(configuration.onEnterRules
			? {
					onEnterRules: Object.freeze(
						configuration.onEnterRules.map((rule) =>
							Object.freeze({
								beforeText: plain(
									rule.beforeText,
									"beforeText",
								),
								...(rule.afterText
									? {
											afterText: plain(
												rule.afterText,
												"afterText",
											),
										}
									: {}),
								...(rule.previousLineText
									? {
											previousLineText: plain(
												rule.previousLineText,
												"previousLineText",
											),
										}
									: {}),
								action: Object.freeze({ ...rule.action }),
							}),
						),
					),
				}
			: {}),
		...(configuration.folding
			? {
					folding: Object.freeze({
						...(configuration.folding.offSide !== undefined
							? {
									offSide: Boolean(
										configuration.folding.offSide,
									),
								}
							: {}),
						...(markers
							? {
									markers: Object.freeze({
										start: plain(
											markers.start,
											"folding start marker",
										),
										end: plain(
											markers.end,
											"folding end marker",
										),
									}),
								}
							: {}),
					}),
				}
			: {}),
		...(configuration.autoClosingPairs
			? {
					autoClosingPairs: Object.freeze(
						configuration.autoClosingPairs.map((pair) =>
							Object.freeze({
								...pair,
								...(pair.notIn
									? { notIn: Object.freeze([...pair.notIn]) }
									: {}),
							}),
						),
					),
				}
			: {}),
		...(configuration.surroundingPairs
			? {
					surroundingPairs: Object.freeze(
						configuration.surroundingPairs.map(([open, close]) =>
							Object.freeze([open, close] as const),
						),
					),
				}
			: {}),
	};
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
	if (
		configuration.colorizedBracketPairs
			?.flat()
			.some((character) => character.length !== 1)
	)
		throw new Error(
			"Colorized bracket pairs must use single UTF-16 characters.",
		);
	return Object.freeze({
		...configuration,
		...normalized,
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

const resolved = new WeakMap<LanguageConfiguration, LanguageConfiguration>();

export function getLanguageConfiguration(
	languageId: string,
): LanguageConfiguration {
	const configuration =
		getLanguage(languageId)?.configuration ?? plainTextConfiguration;
	let value = resolved.get(configuration);
	if (!value) {
		value = resolveLanguageConfiguration(configuration);
		resolved.set(configuration, value);
	}
	return value;
}
