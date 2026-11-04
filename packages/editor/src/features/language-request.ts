import type { Completion, LanguageContext } from "../api/languages";
import { languageProviders } from "../api/languages";
import { languageEngine } from "../languages/client";
export async function requestLanguage<T>(
	method: string,
	context: LanguageContext,
	extra: Record<string, unknown> = {},
): Promise<T> {
	for (const provider of languageProviders(context.model.getLanguageId())) {
		let value: unknown;
		switch (method) {
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
				value = await provider.rename?.(
					context,
					String(extra.name ?? ""),
				);
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
		if (value !== undefined) return value as T;
	}
	return languageEngine.request<T>(
		method,
		context.model,
		context.offset,
		context.signal,
		extra,
	);
}
