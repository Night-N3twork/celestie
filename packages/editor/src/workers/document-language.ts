import type { Analysis, Completion } from "../api/languages";
import type { FoldingRules } from "../languages/configuration";
import { indentationFolds } from "../languages/indentation-folds";
import type { LanguageDocument, SerializedPattern } from "./language-protocol";
import { syntaxTokens } from "./syntax-tokens";

const pattern = ({ source, flags }: SerializedPattern, extra = ""): RegExp =>
	new RegExp(source, flags.replace(/[gy]/g, "") + extra);

function foldingRules(document: LanguageDocument): FoldingRules {
	const folding = document.profile.folding;
	return {
		offSide: folding?.offSide === true,
		...(folding?.markers
			? {
					markers: {
						start: pattern(folding.markers.start),
						end: pattern(folding.markers.end),
					},
				}
			: {}),
	};
}

export function analyzeDocument(document: LanguageDocument): Analysis {
	return {
		tokens: syntaxTokens(document),
		diagnostics: [],
		folds: indentationFolds(document.text, foldingRules(document)),
		symbols: [],
	};
}

export function completeWords(
	document: LanguageDocument,
	offset: number,
): Completion[] {
	const word = pattern(document.profile.word, "g");
	const lineStart = document.text.lastIndexOf("\n", offset - 1) + 1;
	let prefix = "";
	for (const match of document.text.slice(lineStart, offset).matchAll(word))
		if (match.index + match[0].length === offset - lineStart)
			prefix = match[0];
	const words = new Set(document.profile.keywords);
	for (const match of document.text.matchAll(word))
		if (match[0] && !/^[-+.]?\d/.test(match[0])) words.add(match[0]);
	return [...words]
		.filter(
			(candidate) =>
				candidate !== prefix &&
				candidate.toLowerCase().startsWith(prefix.toLowerCase()),
		)
		.slice(0, 200)
		.map((candidate) => ({
			label: candidate,
			insertText: candidate,
			from: offset - prefix.length,
			to: offset,
			kind: "word",
			detail: "Document word",
		}));
}
