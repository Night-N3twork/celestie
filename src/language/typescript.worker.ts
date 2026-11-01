import ts from "typescript";
import type {
	LanguageDocument,
	LanguageRequest,
	LanguageResponse,
	Problem,
} from "./protocol";

const rawLibs = import.meta.glob(
	"../../node_modules/typescript/lib/lib*.d.ts",
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const libraries = new Map(
	Object.entries(rawLibs).map(([path, text]) => [
		`/lib/${path.split("/").at(-1)}`,
		text,
	]),
);
function analyze(request: LanguageRequest): LanguageDocument[] {
	const files = new Map(request.files.map((file) => [file.path, file.text]));
	const read = (path: string) => files.get(path) ?? libraries.get(path);
	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => ({
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			jsx: ts.JsxEmit.Preserve,
			strict: true,
			allowJs: true,
			checkJs: true,
			noEmit: true,
			skipLibCheck: true,
			allowImportingTsExtensions: true,
		}),
		getScriptFileNames: () =>
			[...files.keys()].filter((path) => /\.[cm]?[jt]sx?$/.test(path)),
		getScriptVersion: () => String(request.version),
		getScriptSnapshot: (path) => {
			const text = read(path);
			return text === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(text);
		},
		getCurrentDirectory: () => "/",
		getDefaultLibFileName: () => "/lib/lib.es2022.full.d.ts",
		fileExists: (path) => read(path) !== undefined,
		readFile: read,
		readDirectory: () => [...files.keys()],
		directoryExists: (path) =>
			[...files.keys(), ...libraries.keys()].some((file) =>
				file.startsWith(`${path}/`),
			),
		getDirectories: () => [],
	};
	const config = request.files.find((file) =>
		/\/tsconfig\.json$/.test(file.path),
	);
	if (config) {
		const parsed = ts.parseConfigFileTextToJson(config.path, config.text);
		const options = ts.convertCompilerOptionsFromJson(
			parsed.config?.compilerOptions ?? {},
			config.path.slice(0, config.path.lastIndexOf("/")),
		).options;
		const defaults = host.getCompilationSettings();
		host.getCompilationSettings = () => ({
			...defaults,
			...options,
			noEmit: true,
		});
	}
	const service = ts.createLanguageService(host);
	const documents = request.files
		.filter(
			(file) =>
				request.open.includes(file.id) &&
				/\.[cm]?[jt]sx?$/.test(file.path),
		)
		.map((file) => {
			const source = service.getProgram()?.getSourceFile(file.path);
			const problems: Problem[] = [
				...service.getSyntacticDiagnostics(file.path),
				...service.getSemanticDiagnostics(file.path),
			].map((d) => {
				const from = d.start ?? 0,
					position = source?.getLineAndCharacterOfPosition(from) ?? {
						line: 0,
						character: 0,
					};
				return {
					id: file.id,
					from,
					to: from + (d.length ?? 0),
					line: position.line + 1,
					column: position.character + 1,
					message: ts.flattenDiagnosticMessageText(
						d.messageText,
						"\n",
					),
					code: d.code,
					severity:
						d.category === ts.DiagnosticCategory.Error
							? "error"
							: "warning",
				};
			});
			const tokens = service
				.getSyntacticClassifications(file.path, {
					start: 0,
					length: file.text.length,
				})
				.map((span) => ({
					from: span.textSpan.start,
					to: span.textSpan.start + span.textSpan.length,
					kind: span.classificationType,
				}));
			return { id: file.id, text: file.text, tokens, problems };
		});
	service.dispose();
	return documents;
}
self.onmessage = (event: MessageEvent<LanguageRequest>) => {
	const request = event.data;
	try {
		const projects = new Map<string, LanguageRequest["files"]>();
		for (const file of request.files) {
			const project =
				/^\/workspace\d+|^\/untitled\/[^/]+/.exec(file.path)?.[0] ??
				"/";
			const files = projects.get(project) ?? [];
			files.push(file);
			projects.set(project, files);
		}
		const documents = [...projects.values()]
			.filter((files) =>
				files.some((file) => request.open.includes(file.id)),
			)
			.flatMap((files) => analyze({ ...request, files }));
		self.postMessage({
			version: request.version,
			documents,
		} satisfies LanguageResponse);
	} catch (error) {
		self.postMessage({
			version: request.version,
			documents: [],
			error: String(error),
		} satisfies LanguageResponse);
	}
};
