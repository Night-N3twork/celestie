import { completeWords } from "./document-language";
import type {
	LanguageDocument,
	LanguageRequest as Request,
} from "./language-protocol";
import { disposeSyntaxTokens, setEmbeddedLanguages } from "./syntax-tokens";
import { analyzeWithTokenizer, disposeTokenizer } from "./tokenizer-extensions";

const documents = new Map<string, LanguageDocument>();
const requests = new Map<
	number,
	{ documentId: string; controller: AbortController }
>();
const listResults = new Set([
	"definitions",
	"references",
	"rename",
	"format",
	"actions",
]);

function run(request: Request, signal: AbortSignal): unknown {
	if (request.method === "cancel") {
		requests.get(request.requestId ?? -1)?.controller.abort();
		return null;
	}
	if (request.method === "languages") {
		setEmbeddedLanguages(request.languages ?? []);
		return null;
	}
	if (request.method === "sync" && request.document) {
		documents.set(request.document.id, request.document);
		return null;
	}
	if (request.method === "close") {
		for (const entry of requests.values())
			if (entry.documentId === request.documentId)
				entry.controller.abort();
		disposeTokenizer(request.documentId ?? "");
		documents.delete(request.documentId ?? "");
		disposeSyntaxTokens(request.documentId ?? "");
		return null;
	}
	const document = documents.get(request.documentId ?? "");
	if (!document) throw new Error("Document is no longer available.");
	if (request.method === "analyze")
		return analyzeWithTokenizer(document, signal);
	if (document.text.length > 600000)
		throw new Error("Assistance is paused for this large document.");
	if (request.method === "complete")
		return completeWords(document, request.offset ?? 0);
	return listResults.has(request.method) ? [] : null;
}
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage(value: unknown): void;
};
scope.onmessage = async (event) => {
	const controller = new AbortController();
	if (event.data.id)
		requests.set(event.data.id, {
			documentId: event.data.documentId ?? "",
			controller,
		});
	try {
		const result = await run(event.data, controller.signal);
		if (!controller.signal.aborted && event.data.id)
			scope.postMessage({ id: event.data.id, result });
	} catch (error) {
		if (controller.signal.aborted) return;
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		if (event.data.id) requests.delete(event.data.id);
	}
};
