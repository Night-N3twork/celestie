import type { DocumentLink } from "../api/language-contributions";
import type {
	Analysis,
	CodeAction,
	CodeLens,
	Completion,
	DocumentColor,
	InlayHint,
	LanguageContext,
	LanguageProvider,
} from "../api/languages";
import { languageProviders } from "../api/languages";
import { languageEngine } from "../languages/client";
import {
	awaitProviderResult,
	validateProviderResult,
} from "./provider-results";
import type { SemanticContributions } from "./semantic-contributions";

const origins = new WeakMap<object, LanguageProvider>();
const independent = new Set([
	"semanticTokens",
	"diagnostics",
	"foldingRanges",
	"documentSymbols",
	"documentColors",
	"inlayHints",
	"codeLenses",
]);
const lists = new Set([
	"declarations",
	"typeDefinitions",
	"implementations",
	"documentHighlights",
	"links",
	"selectionRanges",
	"onTypeFormat",
	"inlineCompletions",
	"colorPresentations",
]);
function remember(value: unknown, provider: LanguageProvider): void {
	if (!value || typeof value !== "object") return;
	origins.set(value, provider);
	if (Array.isArray(value))
		for (const item of value) remember(item, provider);
	else if ("items" in value) remember(value.items, provider);
	else
		for (const field of ["hints", "lenses", "colors"] as const)
			if (field in value) remember(Reflect.get(value, field), provider);
}
export function hasLanguageProvider(
	model: LanguageContext["model"],
	method: keyof LanguageProvider,
): boolean {
	return languageProviders(model.getLanguageId()).some(
		(provider) => typeof provider[method] === "function",
	);
}
async function invokeProvider(
	method: string,
	provider: LanguageProvider,
	context: LanguageContext,
	extra: Record<string, unknown>,
): Promise<unknown> {
	let value: unknown;
	switch (method) {
		case "declarations":
			value = await provider.declarations?.(context);
			break;
		case "typeDefinitions":
			value = await provider.typeDefinitions?.(context);
			break;
		case "implementations":
			value = await provider.implementations?.(context);
			break;
		case "documentHighlights":
			value = await provider.documentHighlights?.(context);
			break;
		case "linkedEditing":
			value = await provider.linkedEditing?.(context);
			break;
		case "links":
			value = await provider.links?.(context);
			break;
		case "resolveLink":
			value = await provider.resolveLink?.(
				context,
				extra.item as DocumentLink,
			);
			break;
		case "selectionRanges":
			value = await provider.selectionRanges?.(
				context,
				extra.offsets as readonly number[],
			);
			break;
		case "onTypeFormat":
			value = await provider.onTypeFormat?.(
				context,
				String(extra.character ?? ""),
			);
			break;
		case "inlineCompletions":
			value = await provider.inlineCompletions?.(context);
			break;
		case "prepareRename":
			value = await provider.prepareRename?.(context);
			break;
		case "resolveAction":
			value = await provider.resolveAction?.(
				context,
				extra.item as CodeAction,
			);
			break;
		case "semanticTokens":
			value = await provider.semanticTokens?.(context);
			break;
		case "diagnostics":
			value = await provider.diagnostics?.(context);
			break;
		case "foldingRanges":
			value = await provider.foldingRanges?.(context);
			break;
		case "documentSymbols":
			value = await provider.documentSymbols?.(context);
			break;
		case "documentColors":
			value = await provider.documentColors?.(context);
			break;
		case "inlayHints":
			value = await provider.inlayHints?.(context);
			break;
		case "resolveInlayHint":
			value = await provider.resolveInlayHint?.(
				context,
				extra.item as InlayHint,
			);
			break;
		case "codeLenses":
			value = await provider.codeLenses?.(context);
			break;
		case "resolveCodeLens":
			value = await provider.resolveCodeLens?.(
				context,
				extra.item as CodeLens,
			);
			break;
		case "colorPresentations":
			value = await provider.colorPresentations?.(
				context,
				extra.item as DocumentColor,
				String(extra.color),
			);
			break;
		case "analyze":
			value = await provider.analyze?.(context);
			break;
		case "resolveCompletion":
			value = await provider.resolveCompletion?.(
				context,
				extra.item as Completion,
			);
			break;
		case "complete":
			value = await provider.complete?.(context);
			break;
		case "hover":
			value = await provider.hover?.(context);
			break;
		case "signature":
			value = await provider.signature?.(context);
			break;
		case "definitions":
			value = await provider.definitions?.(context);
			break;
		case "references":
			value = await provider.references?.(context);
			break;
		case "rename":
			value = await provider.rename?.(context, String(extra.name ?? ""));
			break;
		case "format":
			value = await provider.format?.(
				context,
				extra.range as { from: number; to: number } | undefined,
			);
			break;
		case "actions":
			value = await provider.actions?.(context);
			break;
	}
	return value;
}
export async function requestLanguage<T>(
	method: string,
	context: LanguageContext,
	extra: Record<string, unknown> = {},
): Promise<T> {
	context.signal.throwIfAborted();
	const origin =
		extra.item && typeof extra.item === "object"
			? origins.get(extra.item)
			: undefined;
	for (const provider of origin
		? [origin]
		: languageProviders(context.model.getLanguageId())) {
		context.signal.throwIfAborted();
		const value = await awaitProviderResult(
			invokeProvider(method, provider, context, extra),
			context.signal,
			method,
		);
		if (value !== undefined) {
			validateProviderResult(method, value, context.text.length);
			remember(value, provider);
			return value as T;
		}
	}
	if (independent.has(method)) return undefined as T;
	if (lists.has(method)) return [] as T;
	if (
		[
			"linkedEditing",
			"resolveLink",
			"prepareRename",
			"resolveAction",
			"resolveInlayHint",
			"resolveCodeLens",
		].includes(method)
	)
		return null as T;
	return languageEngine.request<T>(
		method,
		context.model,
		context.offset,
		context.signal,
		extra,
	);
}
export async function requestAnalysis(
	context: LanguageContext,
	extra: Record<string, unknown>,
	semantic: SemanticContributions,
): Promise<Analysis> {
	const base = await requestLanguage<Analysis>("analyze", context, extra);
	const isolated = async <T>(request: Promise<T>): Promise<T | undefined> => {
		try {
			return await request;
		} catch (error) {
			if (!context.signal.aborted)
				console.warn("Language contribution failed", error);
			return undefined;
		}
	};
	const [
		semanticTokens,
		diagnostics,
		folds,
		symbols,
		colors,
		hints,
		lenses,
		unicodeHighlights,
	] = await Promise.all([
		isolated(semantic.request(context)),
		isolated(
			requestLanguage<Analysis["diagnostics"] | undefined>(
				"diagnostics",
				context,
			),
		),
		isolated(
			requestLanguage<Analysis["folds"] | undefined>(
				"foldingRanges",
				context,
			),
		),
		isolated(
			requestLanguage<Analysis["symbols"] | undefined>(
				"documentSymbols",
				context,
			),
		),
		isolated(
			requestLanguage<Analysis["colors"]>("documentColors", context),
		),
		isolated(requestLanguage<Analysis["hints"]>("inlayHints", context)),
		isolated(requestLanguage<Analysis["lenses"]>("codeLenses", context)),
		isolated(
			extra.unicodeHighlight
				? languageEngine.request<
						NonNullable<Analysis["unicodeHighlights"]>
					>(
						"unicodeHighlights",
						context.model,
						context.offset,
						context.signal,
						{
							unicodeHighlightOptions:
								extra.unicodeHighlightOptions,
						},
					)
				: Promise.resolve([]),
		),
	]);
	return {
		...base,
		...(semanticTokens !== undefined ? { semanticTokens } : {}),
		...(diagnostics !== undefined ? { diagnostics } : {}),
		...(folds !== undefined ? { folds } : {}),
		...(symbols !== undefined ? { symbols } : {}),
		...(colors !== undefined ? { colors } : {}),
		...(hints !== undefined ? { hints } : {}),
		...(lenses !== undefined ? { lenses } : {}),
		...(unicodeHighlights !== undefined ? { unicodeHighlights } : {}),
	};
}
