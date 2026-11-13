import type {
	ProviderModel,
	ProviderWorkspace,
} from "../api/language-contributions";
import type { LanguageEdit, WorkspaceEdit } from "../api/languages";
export interface PreviewDocument {
	readonly source: ProviderModel;
	readonly text: string;
}
export async function prepareWorkspacePreview(
	edit: WorkspaceEdit,
	workspace: ProviderWorkspace,
	signal: AbortSignal,
): Promise<{ edit: WorkspaceEdit; documents: readonly PreviewDocument[] }> {
	const groups = new Map<string, LanguageEdit[]>();
	for (const item of edit.edits) {
		if (
			!Number.isInteger(item.from) ||
			!Number.isInteger(item.to) ||
			item.from < 0 ||
			item.to < item.from ||
			typeof item.text !== "string" ||
			typeof item.uri !== "string"
		)
			throw new Error("Invalid workspace edit.");
		const group = groups.get(item.uri) ?? [];
		group.push(item);
		groups.set(item.uri, group);
	}
	if (groups.size > 500)
		throw new Error("The change preview is limited to 500 documents.");
	const documents: PreviewDocument[] = [],
		edits: LanguageEdit[] = [];
	let totalLength = 0;
	for (const [uri, items] of groups) {
		signal.throwIfAborted();
		const source = await workspace.resolve(uri, signal);
		signal.throwIfAborted();
		if (!source)
			throw new Error(`Cannot preview unavailable document: ${uri}`);
		if (source.text.length > 4_000_000)
			throw new Error(
				"The preview document exceeds the 4,000,000-character limit.",
			);
		const ordered = [...items].sort(
			(a, b) => a.from - b.from || a.to - b.to,
		);
		let previous: LanguageEdit | undefined;
		for (const item of ordered) {
			if (
				item.to > source.text.length ||
				(item.version !== undefined &&
					item.version !== source.version) ||
				(previous &&
					(item.from < previous.to ||
						(item.from === previous.from && item.from === item.to)))
			)
				throw new Error(
					"The preview contains stale or overlapping edits.",
				);
			previous = item;
			edits.push({
				...item,
				text: item.text.replace(/\r\n?/g, "\n"),
				version: source.version,
			});
		}
		let text = source.text;
		const nextLength =
			source.text.length +
			ordered.reduce(
				(length, item) =>
					length +
					item.text.replace(/\r\n?/g, "\n").length -
					(item.to - item.from),
				0,
			);
		totalLength += source.text.length + nextLength;
		if (nextLength > 4_000_000 || totalLength > 16_000_000)
			throw new Error(
				"The change preview exceeds its character limit (4,000,000 per document).",
			);
		for (const item of [...ordered].reverse())
			text =
				text.slice(0, item.from) +
				item.text.replace(/\r\n?/g, "\n") +
				text.slice(item.to);
		documents.push({ source, text });
	}
	return { edit: { ...edit, edits }, documents };
}
