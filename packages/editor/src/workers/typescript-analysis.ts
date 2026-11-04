import ts from "typescript";
import type { Analysis, Diagnostic, SymbolInformation } from "../api/languages";
import { tokenizeDocument } from "../languages/incremental-tokenizer";
import { indentationFolds } from "../languages/tokenize";
import type {
	LanguageDocument as Document,
	LanguageRequest as Request,
} from "./language-protocol";
import { location } from "./typescript-edits";
import { service } from "./typescript-host";

function symbols(document: Document): SymbolInformation[] {
	const walk = (nodes: readonly ts.NavigationTree[]): SymbolInformation[] =>
		nodes.map((node) => ({
			...location(
				document.file,
				node.nameSpan ?? node.spans[0] ?? { start: 0, length: 0 },
			),
			label: node.text,
			kind: node.kind,
			children: walk(node.childItems ?? []),
		}));
	return walk(service.getNavigationTree(document.file).childItems ?? []);
}
export function analyze(document: Document, request: Request): Analysis {
	if (document.text.length > 600000)
		return {
			tokens: tokenizeDocument(
				document.id,
				document.text,
				document.language,
			),
			diagnostics: [
				{
					from: 0,
					to: 0,
					message:
						"Semantic assistance is paused for this large document; syntax highlighting remains available.",
					severity: "info",
					source: "Editor",
				},
			],
			folds: indentationFolds(document.text),
			symbols: [],
		};
	const supported = ["typescript", "javascript", "json", "jsonc"].includes(
		document.language,
	);
	const diagnostics: Diagnostic[] = supported
		? [
				...service.getSyntacticDiagnostics(document.file),
				...service.getSemanticDiagnostics(document.file),
			]
				.filter((d) => d.start !== undefined)
				.slice(0, 500)
				.map((d) => ({
					from: d.start ?? 0,
					to: (d.start ?? 0) + (d.length ?? 1),
					message: ts.flattenDiagnosticMessageText(
						d.messageText,
						"\n",
					),
					severity:
						d.category === ts.DiagnosticCategory.Error
							? "error"
							: d.category === ts.DiagnosticCategory.Warning
								? "warning"
								: "info",
					code: d.code,
					source: "TypeScript",
				}))
		: [];
	if (document.language === "json")
		try {
			JSON.parse(document.text);
		} catch (error) {
			const message = String(error),
				position = Number(message.match(/position (\d+)/)?.[1] ?? 0);
			diagnostics.push({
				from: position,
				to: Math.min(position + 1, document.text.length),
				message,
				severity: "error",
				source: "JSON",
			});
		}
	const folds = supported
		? service
				.getOutliningSpans(document.file)
				.map((fold) => ({
					start: document.text
						.slice(0, fold.textSpan.start)
						.split("\n").length,
					end: document.text
						.slice(0, fold.textSpan.start + fold.textSpan.length)
						.split("\n").length,
				}))
				.filter((range) => range.end > range.start)
		: indentationFolds(document.text);
	const outline = supported ? symbols(document) : [];
	const tokens = tokenizeDocument(
		document.id,
		document.text,
		document.language,
	);
	if (supported) {
		try {
			const semantic = service.getEncodedSemanticClassifications(
				document.file,
				{ start: 0, length: document.text.length },
				ts.SemanticClassificationFormat.TwentyTwenty,
			);
			for (let i = 0; i < semantic.spans.length; i += 3) {
				const from = semantic.spans[i] ?? 0,
					length = semantic.spans[i + 1] ?? 0,
					type = ((semantic.spans[i + 2] ?? 0) >> 8) - 1;
				if (length)
					tokens.push({
						from,
						to: from + length,
						kind:
							type <= 5
								? "type"
								: type >= 10
									? "function"
									: "variable",
					});
			}
			tokens.sort((a, b) => a.from - b.from || a.to - b.to);
		} catch {
			/* Lexical colors remain available during incomplete programs. */
		}
	}
	const hints =
		supported && request.inlayHints
			? service
					.provideInlayHints(
						document.file,
						{ start: 0, length: document.text.length },
						{
							includeInlayParameterNameHints: "all",
							includeInlayVariableTypeHints: true,
							includeInlayFunctionLikeReturnTypeHints: true,
							includeInlayPropertyDeclarationTypeHints: true,
						},
					)
					.slice(0, 300)
					.map((hint) => ({ offset: hint.position, text: hint.text }))
			: [];
	const flatten = (
		items: readonly SymbolInformation[],
	): SymbolInformation[] =>
		items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
	const lenses =
		supported && request.codeLens
			? flatten(outline)
					.filter((item) =>
						["function", "class", "interface", "method"].includes(
							item.kind,
						),
					)
					.slice(0, 40)
					.map((item) => {
						const count = (
							service.findReferences(document.file, item.from) ??
							[]
						)
							.flatMap((symbol) => symbol.references)
							.filter(
								(reference) => !reference.isDefinition,
							).length;
						return {
							offset: item.from,
							label: `${count} reference${count === 1 ? "" : "s"}`,
							command: "language.references",
						};
					})
			: [];
	return { tokens, diagnostics, folds, symbols: outline, hints, lenses };
}
