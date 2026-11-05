import type { Completion, LanguageContext } from "../api/languages";
import { getLanguage } from "../api/languages";
import {
	getLanguageConfiguration,
	wordExpression,
} from "../languages/configuration";
import { wordRange } from "./editing-commands";
export function prepareCompletions(
	context: LanguageContext,
	values: readonly Completion[],
) {
	const configuration = getLanguageConfiguration(
		context.model.getLanguageId(),
	);
	const lineStart = context.text.lastIndexOf("\n", context.offset - 1) + 1;
	const entries = [...values],
		prefix = context.text.slice(
			lineStart +
				wordRange(
					context.text.slice(lineStart, context.offset),
					context.offset - lineStart,
					wordExpression(configuration),
				).from,
			context.offset,
		);
	for (const snippet of getLanguage(context.model.getLanguageId())
		?.snippets ?? [])
		entries.push({
			label: snippet.label,
			insertText: snippet.body,
			from: context.offset - prefix.length,
			to: context.offset,
			snippet: true,
			detail: snippet.description ?? "Snippet",
		});
	const ordered = entries
		.filter(
			(entry) =>
				!prefix ||
				entry.label.toLowerCase().includes(prefix.toLowerCase()),
		)
		.sort(
			(a, b) =>
				Number(
					!a.label.toLowerCase().startsWith(prefix.toLowerCase()),
				) -
					Number(
						!b.label.toLowerCase().startsWith(prefix.toLowerCase()),
					) || (a.sort ?? a.label).localeCompare(b.sort ?? b.label),
		);
	return { prefix, ordered };
}
