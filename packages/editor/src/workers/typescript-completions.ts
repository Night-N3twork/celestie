import ts from "typescript";
import type { Completion } from "../api/languages";
import type {
	LanguageDocument as Document,
	LanguageRequest as Request,
} from "./language-protocol";
import { edits, typescriptContext } from "./typescript-edits";
import { service } from "./typescript-host";
export function typescriptCompletions(
	request: Request,
	document: Document,
): unknown {
	const { offset, file, supported, settings } = typescriptContext(
		request,
		document,
	);
	if (request.method === "complete") {
		if (!supported) {
			const prefix =
				document.text
					.slice(0, offset)
					.match(/[\p{ID_Continue}$]*$/u)?.[0] ?? "";
			const words = new Set([
				...(document.keywords ?? []),
				...Array.from(
					document.text.matchAll(
						/[\p{ID_Start}_$][\p{ID_Continue}$]*/gu,
					),
					(match) => match[0],
				),
			]);
			return [...words]
				.filter(
					(word) =>
						word !== prefix &&
						word.toLowerCase().startsWith(prefix.toLowerCase()),
				)
				.slice(0, 200)
				.map((word) => ({
					label: word,
					insertText: word,
					from: offset - prefix.length,
					to: offset,
					kind: "word",
					detail: "Document word",
				}));
		}
		const result = service.getCompletionsAtPosition(file, offset, {
			includeCompletionsForModuleExports: true,
			includeCompletionsWithInsertText: true,
		});
		const prefix =
			document.text
				.slice(0, offset)
				.match(/[\p{ID_Continue}$]*$/u)?.[0] ?? "";
		return (result?.entries ?? [])
			.filter(
				(entry) =>
					!prefix ||
					entry.name.toLowerCase().includes(prefix.toLowerCase()),
			)
			.sort(
				(a, b) =>
					Number(
						!a.name.toLowerCase().startsWith(prefix.toLowerCase()),
					) -
						Number(
							!b.name
								.toLowerCase()
								.startsWith(prefix.toLowerCase()),
						) ||
					a.sortText.localeCompare(b.sortText) ||
					a.name.localeCompare(b.name),
			)
			.slice(0, 300)
			.map(
				(entry): Completion => ({
					label: entry.name,
					...(entry.source ? { source: entry.source } : {}),
					...(entry.data ? { data: entry.data } : {}),
					insertText: entry.insertText ?? entry.name,
					...((entry.commitCharacters ??
					result?.defaultCommitCharacters)
						? {
								commitCharacters:
									entry.commitCharacters ??
									result?.defaultCommitCharacters ??
									[],
							}
						: {}),
					from:
						entry.replacementSpan?.start ?? offset - prefix.length,
					to: entry.replacementSpan
						? entry.replacementSpan.start +
							entry.replacementSpan.length
						: offset,
					kind: entry.kind,
					sort: entry.sortText,
					detail: entry.source ?? entry.kind,
				}),
			);
	}
	if (request.method === "resolveCompletion") {
		if (!supported) return null;
		const details = service.getCompletionEntryDetails(
			file,
			offset,
			request.name ?? "",
			settings,
			request.source,
			{},
			request.data,
		);
		if (details?.codeActions?.some((action) => action.commands?.length))
			throw new Error(
				"This completion requires an unsupported workspace command.",
			);
		return details
			? {
					detail:
						ts.displayPartsToString(details.displayParts) +
						"\n" +
						ts.displayPartsToString(details.documentation),
					edits: edits(
						(details.codeActions ?? []).flatMap(
							(action) => action.changes,
						),
					),
				}
			: null;
	}
	return null;
}
