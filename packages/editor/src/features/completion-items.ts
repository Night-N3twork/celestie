import type { Completion, LanguageContext } from "../api/languages";
import { getLanguage } from "../api/languages";
export function prepareCompletions(
	context: LanguageContext,
	values: readonly Completion[],
) {
	const entries = [...values],
		prefix =
			context.text
				.slice(0, context.offset)
				.match(/[\p{ID_Continue}$]*$/u)?.[0] ?? "";
	const snippets =
		getLanguage(context.model.getLanguageId())?.snippets ??
		(context.model.getLanguageId() === "typescript" ||
		context.model.getLanguageId() === "javascript"
			? [
					{
						label: "for",
						body: `for (let \${1:i} = 0; \${1:i} < \${2:count}; \${1:i}++) {\n\t$0\n}`,
					},
					{
						label: "function",
						body: `function \${1:name}(\${2:args}) {\n\t$0\n}`,
					},
					{
						label: "if",
						body: `if (\${1:condition}) {\n\t$0\n}`,
					},
				]
			: []);
	for (const snippet of snippets)
		entries.push({
			label: snippet.label,
			insertText: snippet.body,
			from: context.offset - prefix.length,
			to: context.offset,
			snippet: true,
			detail: "Snippet",
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
