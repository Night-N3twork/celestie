import {
	getLanguage,
	getLanguages,
	languageRegistryVersion,
} from "../api/languages";
import { languageTokenizer } from "../api/tokenization";
import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type {
	EmbeddedLanguage,
	LanguageProfile,
	SerializedPattern,
} from "../workers/language-protocol";
import { getLanguageConfiguration, wordExpression } from "./configuration";

const serialized = (pattern: RegExp): SerializedPattern => ({
	source: pattern.source,
	flags: pattern.flags.replace(/[gy]/g, ""),
});

export function languageProfile(languageId: string): LanguageProfile {
	const definition = getLanguage(languageId),
		configuration = getLanguageConfiguration(languageId),
		markers = configuration.folding?.markers,
		tokenizer = languageTokenizer(languageId);
	return {
		...(tokenizer ? { tokenizer } : {}),
		...(definition?.grammar ? { grammar: definition.grammar } : {}),
		...(definition?.fencedCode ? { fencedCode: true } : {}),
		...(configuration.lineComment
			? { lineComment: configuration.lineComment }
			: {}),
		...(configuration.blockComment
			? { blockComment: configuration.blockComment }
			: {}),
		quotes: configuration.quotes,
		...(configuration.templateQuote
			? { templateQuote: configuration.templateQuote }
			: {}),
		colorizedBrackets:
			configuration.colorizedBracketPairs ?? configuration.brackets,
		keywords: definition?.keywords ?? [],
		word: serialized(wordExpression(configuration)),
		...(configuration.folding
			? {
					folding: {
						offSide: configuration.folding.offSide === true,
						...(markers
							? {
									markers: {
										start: serialized(markers.start),
										end: serialized(markers.end),
									},
								}
							: {}),
					},
				}
			: {}),
	};
}

export function embeddedLanguages(): EmbeddedLanguage[] {
	return getLanguages().flatMap((definition) =>
		definition.grammar
			? [
					{
						grammar: definition.grammar,
						names: [
							definition.id,
							...(definition.aliases ?? []),
							...definition.extensions
								.filter((extension) =>
									/^\.[^.]+$/.test(extension),
								)
								.map((extension) => extension.slice(1)),
						].map((name) => name.toLowerCase()),
					},
				]
			: [],
	);
}

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	cleanup(): void;
}
class LanguageEngine {
	private worker: Worker | undefined;
	private sequence = 0;
	private registryVersion = -1;
	private readonly pending = new Map<number, Pending>();
	private readonly synced = new WeakMap<
		TextModel,
		{ worker: Worker; key: string }
	>();
	private readonly models = new Map<
		TextModel,
		{ references: number; subscriptions: Disposable[] }
	>();
	private ensure(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(
			new URL("../workers/languages.worker.ts", import.meta.url),
			{ type: "module" },
		);
		this.worker = worker;
		this.registryVersion = -1;
		worker.onmessage = (event) => {
			const message = event.data as {
				id: number;
				result?: unknown;
				error?: string;
			};
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			pending.cleanup();
			if (message.error) pending.reject(new Error(message.error));
			else pending.resolve(message.result);
		};
		worker.onerror = () => {
			if (this.worker !== worker) return;
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.cleanup();
				pending.reject(
					new Error(
						"Language worker failed. Run the command again to restart it.",
					),
				);
			}
			this.pending.clear();
			worker.terminate();
			this.worker = undefined;
		};
		for (const model of this.models.keys()) this.sync(model);
		return worker;
	}
	private sync(model: TextModel): void {
		const worker = this.worker;
		if (!worker) return;
		const registryVersion = languageRegistryVersion();
		if (this.registryVersion !== registryVersion) {
			this.registryVersion = registryVersion;
			worker.postMessage({
				id: 0,
				method: "languages",
				languages: embeddedLanguages(),
			});
		}
		const key = `${model.getVersionId()}:${model.getLanguageId()}:${registryVersion}:${languageTokenizer(model.getLanguageId())?.version ?? -1}`;
		const previous = this.synced.get(model);
		if (previous?.worker === worker && previous.key === key) return;
		worker.postMessage({
			id: 0,
			method: "sync",
			document: {
				id: model.id,
				uri: model.uri.toString(),
				text: model.getValue({ eol: "\n" }),
				version: model.getVersionId(),
				language: model.getLanguageId(),
				profile: languageProfile(model.getLanguageId()),
			},
		});
		this.synced.set(model, { worker, key });
	}
	attach(model: TextModel): Disposable {
		let entry = this.models.get(model);
		if (entry) entry.references++;
		else {
			entry = { references: 1, subscriptions: [] };
			this.models.set(model, entry);
			entry.subscriptions.push(
				model.onDidChangeContent(() => this.sync(model)),
				model.onDidChangeLanguage(() => this.sync(model)),
				model.onWillDispose(() => this.remove(model)),
			);
			this.ensure();
			this.sync(model);
		}
		let active = true;
		return {
			dispose: () => {
				if (!active) return;
				active = false;
				const entry = this.models.get(model);
				if (entry && --entry.references <= 0) this.remove(model);
			},
		};
	}
	private remove(model: TextModel): void {
		const entry = this.models.get(model);
		if (!entry) return;
		this.models.delete(model);
		this.synced.delete(model);
		for (const sub of entry.subscriptions) sub.dispose();
		this.worker?.postMessage({
			id: 0,
			method: "close",
			documentId: model.id,
		});
		if (!this.models.size) {
			this.worker?.terminate();
			this.worker = undefined;
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.cleanup();
				pending.reject(new Error("Language workspace closed."));
			}
			this.pending.clear();
		}
	}
	getModels(): readonly TextModel[] {
		return [...this.models.keys()].filter((model) => !model.isDisposed());
	}
	request<T>(
		method: string,
		model: TextModel,
		offset: number,
		signal: AbortSignal,
		extra: Record<string, unknown> = {},
	): Promise<T> {
		if (signal.aborted)
			return Promise.reject(new DOMException("Cancelled", "AbortError"));
		if (this.pending.size >= 32)
			return Promise.reject(new Error("Language service is busy."));
		const worker = this.ensure(),
			id = ++this.sequence;
		return new Promise<T>((resolve, reject) => {
			const abort = () => {
				const pending = this.pending.get(id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(id);
				worker.postMessage({ id: 0, method: "cancel", requestId: id });
				signal.removeEventListener("abort", abort);
				reject(new DOMException("Cancelled", "AbortError"));
			};
			signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(() => {
				this.pending.delete(id);
				worker.postMessage({ id: 0, method: "cancel", requestId: id });
				signal.removeEventListener("abort", abort);
				reject(new Error("Language request timed out."));
			}, 10000);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
				cleanup: () => signal.removeEventListener("abort", abort),
			});
			this.sync(model);
			worker.postMessage({
				id,
				method,
				documentId: model.id,
				offset,
				...extra,
			});
		});
	}
}
export const languageEngine = new LanguageEngine();
