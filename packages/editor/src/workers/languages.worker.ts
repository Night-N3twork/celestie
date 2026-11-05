import { analyzeDocument, completeWords } from "./document-language";
import type {
	LanguageDocument,
	LanguageRequest as Request,
} from "./language-protocol";
import { disposeSyntaxTokens, setEmbeddedLanguages } from "./syntax-tokens";

const documents = new Map<string, LanguageDocument>();
const listResults = new Set([
	"definitions",
	"references",
	"rename",
	"format",
	"actions",
]);

function run(request: Request): unknown {
	if (request.method === "languages") {
		setEmbeddedLanguages(request.languages ?? []);
		return null;
	}
	if (request.method === "sync" && request.document) {
		documents.set(request.document.id, request.document);
		return null;
	}
	if (request.method === "close") {
		documents.delete(request.documentId ?? "");
		disposeSyntaxTokens(request.documentId ?? "");
		return null;
	}
	const document = documents.get(request.documentId ?? "");
	if (!document) throw new Error("Document is no longer available.");
	if (request.method === "analyze") return analyzeDocument(document);
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
scope.onmessage = (event) => {
	try {
		scope.postMessage({ id: event.data.id, result: run(event.data) });
	} catch (error) {
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
