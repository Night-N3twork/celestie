import type {
	ProviderModel,
	ProviderWorkspace,
} from "../api/language-contributions";
import { languageEngine } from "../languages/client";
import type { TextModel } from "../model/text-model";
export function providerWorkspace(
	current: () => TextModel | null,
): ProviderWorkspace {
	const models = (): ProviderModel[] =>
		[...new Set([current(), ...languageEngine.getModels()])].flatMap(
			(model) =>
				model && !model.isDisposed()
					? [
							{
								uri: model.uri.toString(),
								text: model.getValue({ eol: "\n" }),
								version: model.getVersionId(),
								language: model.getLanguageId(),
							},
						]
					: [],
		);
	return {
		models,
		resolve: (uri, signal) => {
			signal.throwIfAborted();
			return models().find((model) => model.uri === uri);
		},
	};
}
