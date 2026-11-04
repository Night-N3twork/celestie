import ts from "typescript";
import type {
	Analysis,
	CodeAction,
	Completion,
	Diagnostic,
	Hover,
	LanguageEdit,
	LanguageServiceSettings,
	Location,
	SymbolInformation,
} from "../api/languages";
import {
	disposeTokens,
	tokenizeDocument,
} from "../languages/incremental-tokenizer";
import { indentationFolds } from "../languages/tokenize";
import { configureWeb, webLanguage } from "./web-languages";

interface Document {
	id: string;
	uri: string;
	text: string;
	version: number;
	language: string;
	file: string;
	keywords?: readonly string[];
}
interface Request {
	source?: string;
	data?: ts.CompletionEntryData;
	inlayHints?: boolean;
	codeLens?: boolean;
	settings?: LanguageServiceSettings;
	id: number;
	method: string;
	document?: Document;
	documentId?: string;
	offset?: number;
	name?: string;
	range?: { from: number; to: number };
	options?: { tabSize: number; insertSpaces: boolean };
}
const libraries = import.meta.glob<string>(
	"../../../../node_modules/typescript/lib/lib.*.d.ts",
	{ query: "?raw", import: "default", eager: true },
);
const libs = new Map(
	Object.entries(libraries).map(([path, text]) => [
		`/${path.split("/").at(-1)}`,
		text,
	]),
);
const documents = new Map<string, Document>();
const lookup = (file: string) =>
	[...documents.values()].find((document) => document.file === file);
let compilerOverrides: ts.CompilerOptions = {};
const host: ts.LanguageServiceHost = {
	getCompilationSettings: () => ({
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		allowJs: true,
		checkJs: true,
		jsx: ts.JsxEmit.ReactJSX,
		allowNonTsExtensions: true,
		resolveJsonModule: true,
		...compilerOverrides,
	}),
	getScriptFileNames: () =>
		[...documents.values()]
			.filter((document) =>
				["typescript", "javascript", "json", "jsonc"].includes(
					document.language,
				),
			)
			.map((document) => document.file),
	getScriptVersion: (file) => {
		const document = lookup(file);
		return `${document?.version ?? 0}:${document?.language ?? "library"}`;
	},
	getScriptSnapshot: (file) => {
		const text = lookup(file)?.text ?? libs.get(file);
		return text === undefined
			? undefined
			: ts.ScriptSnapshot.fromString(text);
	},
	getCurrentDirectory: () => "/workspace",
	getDefaultLibFileName: () => "/lib.es2022.full.d.ts",
	fileExists: (file) => Boolean(lookup(file)) || libs.has(file),
	readFile: (file) => lookup(file)?.text ?? libs.get(file),
	readDirectory: () => [],
	directoryExists: () => true,
	getScriptKind: (file) => {
		const language = lookup(file)?.language;
		return language === "json" || language === "jsonc"
			? ts.ScriptKind.JSON
			: language === "javascript"
				? /jsx$/.test(file)
					? ts.ScriptKind.JSX
					: ts.ScriptKind.JS
				: /tsx$/.test(file)
					? ts.ScriptKind.TSX
					: ts.ScriptKind.TS;
	},
};
const service = ts.createLanguageService(host);
const location = (file: string, span: ts.TextSpan): Location => {
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
const canApplyChanges = (changes: readonly ts.FileTextChanges[]): boolean =>
	changes.every(
		(change) => !change.isNewFile && Boolean(lookup(change.fileName)),
	);
const edits = (changes: readonly ts.FileTextChanges[]): LanguageEdit[] => {
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
function analyze(document: Document, request: Request): Analysis {
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
async function run(request: Request): Promise<unknown> {
	if (request.method === "configure") {
		const converted = ts.convertCompilerOptionsFromJson(
			request.settings?.compilerOptions ?? {},
			"/workspace",
		);
		if (converted.errors.length)
			throw new Error(
				ts.flattenDiagnosticMessageText(
					converted.errors[0]?.messageText ??
						"Invalid compiler settings.",
					"\n",
				),
			);
		compilerOverrides = converted.options;
		configureWeb(request.settings?.jsonSchemas ?? []);
		for (const id of documents.keys())
			if (id.startsWith("extra:")) documents.delete(id);
		for (const library of request.settings?.extraLibraries ?? []) {
			const file = library.path.startsWith("/")
				? library.path
				: `/workspace/${library.path}`;
			documents.set(`extra:${file}`, {
				id: `extra:${file}`,
				uri: `library:${file}`,
				text: library.content,
				version: 1,
				language: "typescript",
				file,
			});
		}
		service.cleanupSemanticCache();
		return null;
	}
	if (request.method === "sync" && request.document) {
		documents.set(request.document.id, request.document);
		return null;
	}
	if (request.method === "close") {
		documents.delete(request.documentId ?? "");
		disposeTokens(request.documentId ?? "");
		service.cleanupSemanticCache();
		return null;
	}
	const document = documents.get(request.documentId ?? "");
	if (!document) throw new Error("Document is no longer available.");
	if (document.text.length > 600000) {
		if (request.method === "analyze") return analyze(document, request);
		throw new Error(
			"Semantic assistance is paused for this large document.",
		);
	}
	if (
		["html", "css", "scss", "less", "json", "jsonc"].includes(
			document.language,
		)
	)
		return webLanguage(request, document);
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
	if (request.method === "analyze") return analyze(document, request);
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

	if (request.method === "hover") {
		const info = supported
			? service.getQuickInfoAtPosition(file, offset)
			: undefined;
		return info
			? ({
					from: info.textSpan.start,
					to: info.textSpan.start + info.textSpan.length,
					text:
						ts.displayPartsToString(info.displayParts) +
						"\n" +
						ts.displayPartsToString(info.documentation),
				} satisfies Hover)
			: null;
	}
	if (request.method === "signature") {
		const info = supported
			? service.getSignatureHelpItems(file, offset, undefined)
			: undefined;
		const item = info?.items[info.selectedItemIndex];
		return item
			? ts.displayPartsToString(item.prefixDisplayParts) +
					item.parameters
						.map(
							(parameter, index) =>
								`${index === info?.argumentIndex ? "▸ " : ""}${ts.displayPartsToString(parameter.displayParts)}`,
						)
						.join(
							ts.displayPartsToString(item.separatorDisplayParts),
						) +
					ts.displayPartsToString(item.suffixDisplayParts)
			: null;
	}
	if (request.method === "definitions")
		return supported
			? (service.getDefinitionAtPosition(file, offset) ?? []).map(
					(definition) => ({
						...location(definition.fileName, definition.textSpan),
						label: definition.name,
					}),
				)
			: [];
	if (request.method === "references")
		return supported
			? (service.getReferencesAtPosition(file, offset) ?? []).map(
					(reference) =>
						location(reference.fileName, reference.textSpan),
				)
			: [];
	if (request.method === "rename") {
		if (!supported)
			throw new Error("No rename provider for this language.");
		const info = service.getRenameInfo(file, offset, {
			allowRenameOfImportPath: false,
		});
		if (!info.canRename) throw new Error(info.localizedErrorMessage);
		return (
			service.findRenameLocations(file, offset, false, false, true) ?? []
		).flatMap((item) => {
			const target = lookup(item.fileName);
			return target
				? [
						{
							uri: target.uri,
							from: item.textSpan.start,
							to: item.textSpan.start + item.textSpan.length,
							text:
								(item.prefixText ?? "") +
								(request.name ?? "") +
								(item.suffixText ?? ""),
							version: target.version,
						},
					]
				: [];
		});
	}
	if (request.method === "format") {
		if (!supported) {
			if (document.language === "json")
				return [
					{
						uri: document.uri,
						from: 0,
						to: document.text.length,
						text: JSON.stringify(
							JSON.parse(document.text),
							null,
							settings.convertTabsToSpaces
								? settings.tabSize
								: "\t",
						),
					},
				];
			return [];
		}
		const result = request.range
			? service.getFormattingEditsForRange(
					file,
					request.range.from,
					request.range.to,
					settings,
				)
			: service.getFormattingEditsForDocument(file, settings);
		return result.map((edit) => ({
			uri: document.uri,
			from: edit.span.start,
			to: edit.span.start + edit.span.length,
			text: edit.newText,
			version: document.version,
		}));
	}
	if (request.method === "actions") {
		if (!supported) return [];
		const diagnostics = [
			...service.getSyntacticDiagnostics(file),
			...service.getSemanticDiagnostics(file),
		].filter(
			(d) =>
				d.start !== undefined &&
				offset >= (d.start ?? 0) &&
				offset <= (d.start ?? 0) + (d.length ?? 1),
		);
		const result: CodeAction[] = [];
		for (const diagnostic of diagnostics)
			for (const fix of service.getCodeFixesAtPosition(
				file,
				diagnostic.start ?? offset,
				(diagnostic.start ?? offset) + (diagnostic.length ?? 0),
				[diagnostic.code],
				settings,
				{},
			))
				if (canApplyChanges(fix.changes) && !fix.commands?.length)
					result.push({
						title: fix.description,
						edits: edits(fix.changes),
					});
		result.push({
			title: "Organize imports",
			edits: edits(
				service.organizeImports(
					{ type: "file", fileName: file },
					settings,
					{},
				),
			),
		});
		return result.filter((action) => action.edits.length);
	}
	return null;
}
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage(value: unknown): void;
};
scope.onmessage = async (event) => {
	try {
		scope.postMessage({ id: event.data.id, result: await run(event.data) });
	} catch (error) {
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
