import { completeWords } from "./document-language";
import type {
	LanguageDocument,
	LanguageRequest as Request,
} from "./language-protocol";
import { disposeSyntaxTokens, setEmbeddedLanguages } from "./syntax-tokens";
import { analyzeWithTokenizer, disposeTokenizer } from "./tokenizer-extensions";
import { unicodeHighlights } from "./unicode-highlights";

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

function abortDocument(id: string): void {
	for (const entry of requests.values())
		if (entry.documentId === id) entry.controller.abort();
}
function run(request: Request, signal: AbortSignal): unknown {
	if (request.method === "cancel") {
		requests.get(request.requestId ?? -1)?.controller.abort();
		scope.postMessage({ id: request.requestId ?? 0, cancelled: true });
		return null;
	}
	if (request.method === "languages") {
		setEmbeddedLanguages(request.languages ?? []);
		return null;
	}
	if (request.method === "sync" && request.document) {
		abortDocument(request.document.id);
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
	if (request.method === "patch") {
		const document = documents.get(request.documentId ?? "");
		if (!document || document.version !== request.baseVersion) {
			scope.postMessage({
				id: 0,
				requiresSync: true,
				documentId: request.documentId,
			});
			return null;
		}
		const changes = request.changes ?? [];
		let end = 0;
		for (const change of changes) {
			if (
				!Number.isInteger(change.offset) ||
				!Number.isInteger(change.length) ||
				change.offset < end ||
				change.length < 0 ||
				change.offset + change.length > document.text.length ||
				typeof change.text !== "string"
			)
				throw new Error("Invalid document patch.");
			end = change.offset + change.length;
		}
		abortDocument(document.id);
		let text = document.text;
		for (let index = changes.length - 1; index >= 0; index--) {
			const change = changes[index];
			if (change)
				text =
					text.slice(0, change.offset) +
					change.text +
					text.slice(change.offset + change.length);
		}
		documents.set(document.id, {
			...document,
			text,
			version: request.version ?? document.version,
		});
		return null;
	}
	const document = documents.get(request.documentId ?? "");
	if (!document) throw new Error("Document is no longer available.");
	if (request.version !== undefined && document.version !== request.version)
		throw new Error("Document version mismatch.");
	if (request.method === "unicodeHighlights")
		return unicodeHighlights(
			document.text,
			request.unicodeHighlightOptions,
		);
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
		let rejectAbort: ((error: Error) => void) | undefined;
		const onAbort = () =>
			rejectAbort?.(new DOMException("Cancelled", "AbortError"));
		controller.signal.addEventListener("abort", onAbort, { once: true });
		let result: unknown;
		try {
			result = await Promise.race([
				Promise.resolve(run(event.data, controller.signal)),
				new Promise<never>((_, reject) => {
					rejectAbort = reject;
				}),
			]);
		} finally {
			controller.signal.removeEventListener("abort", onAbort);
		}
		if (!controller.signal.aborted && event.data.id)
			scope.postMessage({ id: event.data.id, result });
	} catch (error) {
		if (controller.signal.aborted) {
			if (event.data.id)
				scope.postMessage({ id: event.data.id, cancelled: true });
			return;
		}
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		if (event.data.id) requests.delete(event.data.id);
	}
};
