import ts from "typescript";
import type { LanguageServiceSettings } from "../api/languages";
import type { LanguageDocument as Document } from "./language-protocol";
export const libraries = import.meta.glob<string>(
	"../../../../node_modules/typescript/lib/lib.*.d.ts",
	{ query: "?raw", import: "default", eager: true },
);
export const libs = new Map(
	Object.entries(libraries).map(([path, text]) => [
		`/${path.split("/").at(-1)}`,
		text,
	]),
);
export const documents = new Map<string, Document>();
export const lookup = (file: string) =>
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
export const service = ts.createLanguageService(host);
export function configureCompiler(settings: LanguageServiceSettings): void {
	const converted = ts.convertCompilerOptionsFromJson(
		settings.compilerOptions ?? {},
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

	for (const id of documents.keys())
		if (id.startsWith("extra:")) documents.delete(id);
	for (const library of settings.extraLibraries ?? []) {
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
}
