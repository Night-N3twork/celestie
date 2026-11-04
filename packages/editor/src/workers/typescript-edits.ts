import ts from "typescript";
import type { LanguageEdit, Location } from "../api/languages";
import type {
	LanguageDocument as Document,
	LanguageRequest as Request,
} from "./language-protocol";
import { libs, lookup } from "./typescript-host";
export const location = (file: string, span: ts.TextSpan): Location => {
	const document = lookup(file);
	const text = document?.text ?? libs.get(file) ?? "";
	return {
		uri: document?.uri ?? `library:${file}`,
		from: span.start,
		to: span.start + span.length,
		preview: text.slice(
			Math.max(0, text.lastIndexOf("\n", span.start - 1) + 1),
			text.indexOf("\n", span.start) < 0
				? text.length
				: text.indexOf("\n", span.start),
		),
	};
};
export const canApplyChanges = (
	changes: readonly ts.FileTextChanges[],
): boolean =>
	changes.every(
		(change) => !change.isNewFile && Boolean(lookup(change.fileName)),
	);
export const edits = (
	changes: readonly ts.FileTextChanges[],
): LanguageEdit[] => {
	if (!canApplyChanges(changes))
		throw new Error(
			"This change requires a file that is not attached to the language workspace.",
		);
	return changes.flatMap((change) => {
		const document = lookup(change.fileName);
		return document
			? change.textChanges.map((edit) => ({
					uri: document.uri,
					from: edit.span.start,
					to: edit.span.start + edit.span.length,
					text: edit.newText,
					version: document.version,
				}))
			: [];
	});
};
export function typescriptContext(request: Request, document: Document) {
	const offset = request.offset ?? 0,
		file = document.file,
		supported = ["typescript", "javascript", "json", "jsonc"].includes(
			document.language,
		),
		settings: ts.FormatCodeSettings = {
			...ts.getDefaultFormatCodeSettings("\n"),
			tabSize: request.options?.tabSize ?? 4,
			indentSize: request.options?.tabSize ?? 4,
			convertTabsToSpaces: request.options?.insertSpaces ?? false,
			newLineCharacter: "\n",
			semicolons: ts.SemicolonPreference.Insert,
		};
	return { offset, file, supported, settings };
}
