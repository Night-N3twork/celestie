import { disposeTokens } from "../languages/incremental-tokenizer";
import type { LanguageRequest as Request } from "./language-protocol";
import { analyze } from "./typescript-analysis";
import { typescriptLanguage } from "./typescript-commands";
import { configureCompiler, documents, service } from "./typescript-host";
import { configureWeb, webLanguage } from "./web-languages";

async function run(request: Request): Promise<unknown> {
	if (request.method === "configure") {
		configureCompiler(request.settings ?? {});
		configureWeb(request.settings?.jsonSchemas ?? []);
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
	return typescriptLanguage(request, document);
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
