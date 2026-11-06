import { builtinLanguages } from "../languages/builtin-languages";
import type { LanguageConfiguration } from "../languages/configuration";
import { matchLanguage } from "../languages/file-associations";
import type { TextModel } from "../model/text-model";
import type { Disposable } from "./types";
export interface Token {
	readonly from: number;
	readonly to: number;
	readonly kind: string;
}
export interface Diagnostic {
	readonly from: number;
	readonly to: number;
	readonly message: string;
	readonly severity: "error" | "warning" | "info";
	readonly code?: number;
	readonly source?: string;
}
export interface LanguageEdit {
	readonly uri: string;
	readonly from: number;
	readonly to: number;
	readonly text: string;
	readonly version?: number;
}
export type WorkspaceFileOperation =
	| { readonly kind: "create"; readonly uri: string; readonly text?: string }
	| { readonly kind: "rename"; readonly uri: string; readonly newUri: string }
	| { readonly kind: "delete"; readonly uri: string };
export interface WorkspaceEdit {
	readonly edits: readonly LanguageEdit[];
	readonly fileOperations?: readonly WorkspaceFileOperation[];
}
export interface Location {
	readonly uri: string;
	readonly from: number;
	readonly to: number;
	readonly label?: string;
	readonly preview?: string;
}
export interface Completion {
	readonly commitCharacters?: readonly string[];
	readonly source?: string;
	readonly data?: unknown;
	readonly additionalEdits?: readonly LanguageEdit[];
	readonly label: string;
	readonly insertText: string;
	readonly from: number;
	readonly to: number;
	readonly detail?: string;
	readonly kind?: string;
	readonly snippet?: boolean;
	readonly sort?: string;
}
export interface Hover {
	readonly text: string;
	readonly from: number;
	readonly to: number;
}
export interface SymbolInformation extends Location {
	readonly kind: string;
	readonly children?: readonly SymbolInformation[];
}
export interface CodeAction extends WorkspaceEdit {
	readonly title: string;
	readonly edits: readonly LanguageEdit[];
}
export interface DocumentColor {
	readonly from: number;
	readonly to: number;
	readonly color: string;
}
export interface InlayHint {
	readonly offset: number;
	readonly text: string;
	readonly tooltip?: string;
}
export interface CodeLens {
	readonly offset: number;
	readonly label: string;
	readonly command: string;
}
export interface Analysis {
	readonly semanticTokens?: readonly Token[];
	readonly hints?: readonly InlayHint[];
	readonly lenses?: readonly CodeLens[];
	readonly colors?: readonly DocumentColor[];
	readonly tokens: readonly Token[];
	readonly diagnostics: readonly Diagnostic[];
	readonly folds: readonly { start: number; end: number }[];
	readonly symbols: readonly SymbolInformation[];
}
export interface LanguageContext {
	readonly model: TextModel;
	readonly text: string;
	readonly offset: number;
	readonly signal: AbortSignal;
}
export interface LanguageProvider {
	resolveCompletion?(
		context: LanguageContext,
		item: Completion,
	):
		| Promise<{ detail: string; edits: readonly LanguageEdit[] } | null>
		| { detail: string; edits: readonly LanguageEdit[] }
		| null;
	analyze?(context: LanguageContext): Promise<Analysis> | Analysis;
	complete?(
		context: LanguageContext,
	): Promise<readonly Completion[]> | readonly Completion[];
	hover?(context: LanguageContext): Promise<Hover | null> | Hover | null;
	signature?(
		context: LanguageContext,
	): Promise<string | null> | string | null;
	definitions?(
		context: LanguageContext,
	): Promise<readonly Location[]> | readonly Location[];
	references?(
		context: LanguageContext,
	): Promise<readonly Location[]> | readonly Location[];
	rename?(
		context: LanguageContext,
		newName: string,
	):
		| Promise<readonly LanguageEdit[] | WorkspaceEdit>
		| readonly LanguageEdit[]
		| WorkspaceEdit;
	format?(
		context: LanguageContext,
		range?: { from: number; to: number },
	): Promise<readonly LanguageEdit[]> | readonly LanguageEdit[];
	actions?(
		context: LanguageContext,
	): Promise<readonly CodeAction[]> | readonly CodeAction[];
}
export interface LanguageDefinition {
	readonly id: string;
	readonly name?: string;
	readonly aliases?: readonly string[];
	readonly grammar?: string;
	readonly fencedCode?: boolean;
	readonly extensions: readonly string[];
	readonly filenames?: readonly string[];
	readonly filenamePatterns?: readonly string[];
	readonly firstLine?: RegExp;
	readonly configuration?: LanguageConfiguration;
	readonly keywords?: readonly string[];
	readonly snippets?: readonly {
		label: string;
		body: string;
		description?: string;
	}[];
}
const definitions = new Map<string, LanguageDefinition>();
const providers: {
	languages: readonly string[];
	provider: LanguageProvider;
}[] = [];
let registryVersion = 0;
export function registerLanguage(definition: LanguageDefinition): Disposable {
	if (!definition.id) throw new TypeError("Language id required.");
	const old = definitions.get(definition.id);
	definitions.set(definition.id, definition);
	registryVersion++;
	return {
		dispose() {
			if (definitions.get(definition.id) !== definition) return;
			if (old) definitions.set(definition.id, old);
			else definitions.delete(definition.id);
			registryVersion++;
		},
	};
}
export function languageRegistryVersion(): number {
	return registryVersion;
}
export function getLanguage(id: string): LanguageDefinition | undefined {
	return definitions.get(id);
}
export function getLanguages(): readonly LanguageDefinition[] {
	return [...definitions.values()];
}
export function detectLanguage(path: string, firstLine = ""): string {
	return matchLanguage([...definitions.values()], path, firstLine);
}
export function registerLanguageProvider(
	languages: string | readonly string[],
	provider: LanguageProvider,
): Disposable {
	const entry = {
		languages: typeof languages === "string" ? [languages] : languages,
		provider,
	};
	providers.push(entry);
	return {
		dispose() {
			const index = providers.indexOf(entry);
			if (index >= 0) providers.splice(index, 1);
		},
	};
}
export function languageProviders(id: string): readonly LanguageProvider[] {
	return providers
		.filter(
			(entry) =>
				entry.languages.includes(id) || entry.languages.includes("*"),
		)
		.map((entry) => entry.provider)
		.reverse();
}
for (const definition of builtinLanguages) registerLanguage(definition);
