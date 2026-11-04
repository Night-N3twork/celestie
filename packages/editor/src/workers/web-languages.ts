import {
	getCSSLanguageService,
	getLESSLanguageService,
	getSCSSLanguageService,
} from "vscode-css-languageservice";
import type {
	CompletionItem,
	DocumentSymbol,
	Diagnostic as ServiceDiagnostic,
	Hover as ServiceHover,
	TextEdit,
	WorkspaceEdit,
} from "vscode-html-languageservice";
import { getLanguageService as htmlService } from "vscode-html-languageservice";
import {
	type JSONSchema,
	getLanguageService as jsonService,
} from "vscode-json-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
	Analysis,
	Completion,
	LanguageEdit,
	Location,
	SymbolInformation,
} from "../api/languages";
import { tokenizeDocument } from "../languages/incremental-tokenizer";
export interface WebDocument {
	id: string;
	uri: string;
	text: string;
	version: number;
	language: string;
}
interface WebRequest {
	method: string;
	offset?: number;
	name?: string;
	range?: { from: number; to: number };
	options?: { tabSize: number; insertSpaces: boolean };
}
const html = htmlService(),
	css = getCSSLanguageService(),
	scss = getSCSSLanguageService(),
	less = getLESSLanguageService(),
	json = jsonService({
		schemaRequestService: () =>
			Promise.reject(
				new Error(
					"Remote schema loading is disabled; configure a local schema.",
				),
			),
	});
export function configureWeb(
	schemas: readonly {
		uri: string;
		fileMatch: string[];
		schema: JSONSchema;
	}[],
): void {
	json.configure({ validate: true, schemas: [...schemas] });
}
const documentation = (hover: ServiceHover | null): string | null => {
	const content = hover?.contents;
	if (!content) return null;
	return typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.map((part) =>
						typeof part === "string" ? part : part.value,
					)
					.join("\n")
			: content.value;
};
export async function webLanguage(
	request: WebRequest,
	source: WebDocument,
): Promise<unknown> {
	const document = TextDocument.create(
			source.uri,
			source.language,
			source.version,
			source.text,
		),
		offset = request.offset ?? 0,
		position = document.positionAt(offset),
		range = request.range
			? {
					start: document.positionAt(request.range.from),
					end: document.positionAt(request.range.to),
				}
			: undefined,
		format = {
			tabSize: request.options?.tabSize ?? 4,
			insertSpaces: request.options?.insertSpaces ?? false,
		};
	const edit = (item: TextEdit): LanguageEdit => ({
		uri: source.uri,
		from: document.offsetAt(item.range.start),
		to: document.offsetAt(item.range.end),
		text: item.newText,
		version: source.version,
	});
	const workspace = (value: WorkspaceEdit | null): LanguageEdit[] =>
		Object.entries(value?.changes ?? {}).flatMap(([uri, changes]) =>
			uri === source.uri ? changes.map(edit) : [],
		);
	const completion = (item: CompletionItem): Completion => {
		const replacement = item.textEdit,
			span = replacement
				? "range" in replacement
					? replacement.range
					: replacement.insert
				: {
						start: document.positionAt(
							offset -
								(source.text
									.slice(0, offset)
									.match(/[\w-]*$/)?.[0].length ?? 0),
						),
						end: position,
					};
		return {
			label: item.label,
			insertText: replacement?.newText ?? item.insertText ?? item.label,
			from: document.offsetAt(span.start),
			to: document.offsetAt(span.end),
			detail: item.detail ?? "",
			kind: String(item.kind ?? ""),
			snippet: item.insertTextFormat === 2,
			sort: item.sortText ?? item.label,
		};
	};
	const diagnostics = (items: readonly ServiceDiagnostic[]) =>
		items.map((item) => ({
			from: document.offsetAt(item.range.start),
			to: document.offsetAt(item.range.end),
			message:
				typeof item.message === "string"
					? item.message
					: item.message.value,
			severity:
				item.severity === 1
					? ("error" as const)
					: item.severity === 2
						? ("warning" as const)
						: ("info" as const),
			source: source.language,
			...(typeof item.code === "number" ? { code: item.code } : {}),
		}));
	const colors = (
		values: readonly {
			range: {
				start: { line: number; character: number };
				end: { line: number; character: number };
			};
			color: { red: number; green: number; blue: number; alpha: number };
		}[],
	) =>
		values.slice(0, 500).map((item) => ({
			from: document.offsetAt(item.range.start),
			to: document.offsetAt(item.range.end),
			color:
				"#" +
				[
					item.color.red,
					item.color.green,
					item.color.blue,
					...(item.color.alpha < 1 ? [item.color.alpha] : []),
				]
					.map((channel) =>
						Math.round(channel * 255)
							.toString(16)
							.padStart(2, "0"),
					)
					.join(""),
		}));
	const symbols = (items: readonly DocumentSymbol[]): SymbolInformation[] =>
		items.map((item) => ({
			uri: source.uri,
			from: document.offsetAt(item.selectionRange.start),
			to: document.offsetAt(item.selectionRange.end),
			label: item.name,
			kind: String(item.kind),
			children: symbols(item.children ?? []),
		}));
	if (source.language === "html") {
		const parsed = html.parseHTMLDocument(document);
		switch (request.method) {
			case "analyze":
				return {
					tokens: tokenizeDocument(
						source.id,
						source.text,
						source.language,
					),
					diagnostics: [],
					folds: html.getFoldingRanges(document).map((range) => ({
						start: range.startLine + 1,
						end: range.endLine + 1,
					})),
					symbols: symbols(
						html.findDocumentSymbols2(document, parsed),
					),
				} satisfies Analysis;
			case "complete":
				return html
					.doComplete(document, position, parsed)
					.items.map(completion);
			case "hover": {
				const result = html.doHover(document, position, parsed),
					text = documentation(result);
				return text
					? {
							text,
							from: result?.range
								? document.offsetAt(result.range.start)
								: offset,
							to: result?.range
								? document.offsetAt(result.range.end)
								: offset,
						}
					: null;
			}
			case "format":
				return html.format(document, range, format).map(edit);
			case "rename":
				return workspace(
					html.doRename(
						document,
						position,
						request.name ?? "",
						parsed,
					),
				);
			case "definitions":
			case "references":
				return [];
			case "actions":
				return [];
		}
	}
	if (["css", "scss", "less"].includes(source.language)) {
		const service =
				source.language === "scss"
					? scss
					: source.language === "less"
						? less
						: css,
			parsed = service.parseStylesheet(document);
		switch (request.method) {
			case "analyze":
				return {
					tokens: tokenizeDocument(
						source.id,
						source.text,
						source.language,
					),
					colors: colors(
						service.findDocumentColors(document, parsed),
					),
					diagnostics: diagnostics(
						service.doValidation(document, parsed),
					),
					folds: service.getFoldingRanges(document).map((range) => ({
						start: range.startLine + 1,
						end: range.endLine + 1,
					})),
					symbols: symbols(
						service.findDocumentSymbols2(document, parsed),
					),
				} satisfies Analysis;
			case "complete":
				return service
					.doComplete(document, position, parsed)
					.items.map(completion);
			case "hover": {
				const result = service.doHover(document, position, parsed),
					text = documentation(result);
				return text
					? {
							text,
							from: result?.range
								? document.offsetAt(result.range.start)
								: offset,
							to: result?.range
								? document.offsetAt(result.range.end)
								: offset,
						}
					: null;
			}
			case "format":
				return service.format(document, range, format).map(edit);
			case "rename":
				return workspace(
					service.doRename(
						document,
						position,
						request.name ?? "",
						parsed,
					),
				);
			case "definitions": {
				const result = service.findDefinition(
					document,
					position,
					parsed,
				);
				return result
					? [
							{
								uri: result.uri,
								from: document.offsetAt(result.range.start),
								to: document.offsetAt(result.range.end),
							} satisfies Location,
						]
					: [];
			}
			case "references":
				return service
					.findReferences(document, position, parsed)
					.map((item) => ({
						uri: item.uri,
						from: document.offsetAt(item.range.start),
						to: document.offsetAt(item.range.end),
					}));
			case "actions":
				return service
					.doCodeActions2(
						document,
						range ?? { start: position, end: position },
						{ diagnostics: service.doValidation(document, parsed) },
						parsed,
					)
					.map((action) => ({
						title: action.title,
						edits: workspace(action.edit ?? null),
					}));
		}
	}
	if (source.language === "json" || source.language === "jsonc") {
		const parsed = json.parseJSONDocument(document);
		switch (request.method) {
			case "analyze":
				return {
					tokens: tokenizeDocument(
						source.id,
						source.text,
						source.language,
					),
					colors: colors(
						await json.findDocumentColors(document, parsed),
					),
					diagnostics: diagnostics(
						await json.doValidation(document, parsed, {
							comments:
								source.language === "jsonc"
									? "ignore"
									: "error",
							trailingCommas:
								source.language === "jsonc"
									? "ignore"
									: "error",
						}),
					),
					folds: json.getFoldingRanges(document).map((range) => ({
						start: range.startLine + 1,
						end: range.endLine + 1,
					})),
					symbols: symbols(
						json.findDocumentSymbols2(document, parsed),
					),
				} satisfies Analysis;
			case "complete":
				return (
					(await json.doComplete(document, position, parsed))
						?.items ?? []
				).map(completion);
			case "hover": {
				const result = await json.doHover(document, position, parsed),
					text = documentation(result);
				return text
					? {
							text,
							from: result?.range
								? document.offsetAt(result.range.start)
								: offset,
							to: result?.range
								? document.offsetAt(result.range.end)
								: offset,
						}
					: null;
			}
			case "format":
				return json.format(document, range, format).map(edit);
			case "definitions":
				return (
					await json.findDefinition(document, position, parsed)
				).map((item) => ({
					uri: item.targetUri,
					from: document.offsetAt(item.targetSelectionRange.start),
					to: document.offsetAt(item.targetSelectionRange.end),
				}));
			case "references":
			case "actions":
				return [];
			case "rename":
				throw new Error(
					"JSON rename requires a custom language provider.",
				);
		}
	}
	return null;
}
