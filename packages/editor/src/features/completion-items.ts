import type { CompletionList } from "../api/language-contributions";
import type { Completion, LanguageContext } from "../api/languages";
import { getLanguage } from "../api/languages";
import {
	getLanguageConfiguration,
	wordExpression,
} from "../languages/configuration";
import { validOffsetRange } from "./document-contributions";
import { wordRange } from "./editing-commands";
export function prepareCompletions(
	context: LanguageContext,
	values: readonly Completion[] | CompletionList,
) {
	const configuration = getLanguageConfiguration(
		context.model.getLanguageId(),
	);
	const lineStart =
		context.offset === 0
			? 0
			: context.text.lastIndexOf("\n", context.offset - 1) + 1;
	const entries = [...("items" in values ? values.items : values)],
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
	const score = (value: string): number => {
		const needle = prefix.toLowerCase(),
			haystack = value.toLowerCase();
		if (!needle) return 0;
		if (haystack.startsWith(needle)) return 0;
		let cursor = 0,
			total = 10;
		for (const char of needle) {
			const at = haystack.indexOf(char, cursor);
			if (at < 0) return Infinity;
			total += at - cursor;
			cursor = at + 1;
		}
		return total;
	};
	const ordered = entries
		.filter(
			(entry) =>
				validOffsetRange(entry, context.text.length) &&
				(entry.replaceTo === undefined ||
					(Number.isInteger(entry.replaceTo) &&
						entry.replaceTo >= entry.to &&
						entry.replaceTo <= context.text.length)) &&
				Number.isFinite(score(entry.filterText ?? entry.label)),
		)
		.sort(
			(a, b) =>
				Number(!!b.preselect) - Number(!!a.preselect) ||
				score(a.filterText ?? a.label) -
					score(b.filterText ?? b.label) ||
				(a.sort ?? a.label).localeCompare(b.sort ?? b.label),
		);
	return {
		prefix,
		ordered,
		incomplete: "items" in values && values.incomplete === true,
	};
}
