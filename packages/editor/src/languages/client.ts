import {
	getLanguage,
	getLanguages,
	languageRegistryVersion,
} from "../api/languages";
import type { LanguageWorkerStatistics } from "../api/performance";
import { languageTokenizer } from "../api/tokenization";
import type { Disposable, ModelChangeEvent } from "../api/types";
import { createEditorWorker } from "../api/workers";
import type { TextModel } from "../model/text-model";
import { performanceLimits } from "../performance/limits";
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

export function languageProfile(
	languageId: string,
	tabSize = 4,
): LanguageProfile {
	const definition = getLanguage(languageId),
		configuration = getLanguageConfiguration(languageId),
		markers = configuration.folding?.markers,
		tokenizer = languageTokenizer(languageId);
	return {
		tabSize,
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
	cleanup(): void;
	model: TextModel;
}
class LanguageEngine {
	private worker: Worker | undefined;
	private sequence = 0;
	private registryVersion = -1;
	private readonly pending = new Map<number, Pending>();
	private readonly inFlight = new Map<
		number,
		ReturnType<typeof setTimeout>
	>();
	private readonly synced = new WeakMap<
		TextModel,
		{ worker: Worker; key: string; profile: string; version: number }
	>();
	private readonly models = new Map<
		TextModel,
		{ references: number; subscriptions: Disposable[] }
	>();
	private starts = 0;
	private failures = 0;
	private fullSyncs = 0;
	private patchSyncs = 0;
	private synchronizedCharacters = 0;
	statistics(): LanguageWorkerStatistics {
		return {
			attachedModels: this.models.size,
			pendingRequests: this.pending.size,
			inFlightRequests: this.inFlight.size,
			starts: this.starts,
			failures: this.failures,
			fullSyncs: this.fullSyncs,
			patchSyncs: this.patchSyncs,
			synchronizedCharacters: this.synchronizedCharacters,
			running: !!this.worker,
		};
	}
	private finishFlight(id: number): void {
		const timer = this.inFlight.get(id);
		if (timer !== undefined) clearTimeout(timer);
		this.inFlight.delete(id);
	}
	private fail(error: Error, count = true): void {
		const worker = this.worker;
		this.worker = undefined;
		worker?.terminate();
		if (count) this.failures++;
		for (const id of this.inFlight.keys()) this.finishFlight(id);
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const entry of pending) {
			entry.cleanup();
			entry.reject(error);
		}
	}
	private ensure(): Worker {
		if (this.worker) return this.worker;
		const worker = createEditorWorker(
			"language",
			() =>
				new Worker(
					new URL("../workers/languages.worker.ts", import.meta.url),
					{ type: "module" },
				),
		);
		this.worker = worker;
		this.starts++;
		this.registryVersion = -1;
		worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (this.worker !== worker) return;
			if (
				!data ||
				typeof data !== "object" ||
				!("id" in data) ||
				!Number.isInteger(data.id) ||
				typeof data.id !== "number" ||
				data.id < 0
			) {
				this.fail(new Error("Invalid language worker response."));
				return;
			}
			if (
				"requiresSync" in data &&
				data.requiresSync === true &&
				"documentId" in data
			) {
				for (const model of this.models.keys())
					if (model.id === data.documentId) this.synced.delete(model);
			}
			if (!data.id) return;
			if (
				!("result" in data) &&
				!("error" in data && typeof data.error === "string") &&
				!("cancelled" in data && data.cancelled === true)
			) {
				this.fail(new Error("Invalid language worker response."));
				return;
			}
			this.finishFlight(data.id);
			const entry = this.pending.get(data.id);
			if (!entry) return;
			this.pending.delete(data.id);
			entry.cleanup();
			if ("error" in data) {
				this.synced.delete(entry.model);
				entry.reject(new Error(String(data.error)));
			} else if ("cancelled" in data)
				entry.reject(new DOMException("Cancelled", "AbortError"));
			else if ("result" in data) entry.resolve(data.result);
		};
		worker.onerror = (event) => {
			event.preventDefault();
			if (this.worker === worker)
				this.fail(
					new Error(
						"Language worker failed. Run the command again to restart it.",
					),
				);
		};
		worker.onmessageerror = () => {
			if (this.worker === worker)
				this.fail(new Error("Invalid language worker message."));
		};
		return worker;
	}
	private sync(model: TextModel, event?: ModelChangeEvent): void {
		const worker = this.worker;
		if (!worker || model.isDisposed()) return;
		const registryVersion = languageRegistryVersion();
		const profile = `${model.getLanguageId()}:${registryVersion}:${languageTokenizer(model.getLanguageId())?.version ?? -1}:${model.getOptions().tabSize}`,
			version = model.getVersionId(),
			key = `${version}:${profile}`,
			previous = this.synced.get(model);
		if (previous?.worker === worker && previous.key === key) return;
		try {
			if (event) {
				const changes = event.inputChanges,
					characters =
						changes?.reduce(
							(sum, change) => sum + change.text.length,
							0,
						) ?? Infinity;
				if (
					!event.flush &&
					changes &&
					previous?.worker === worker &&
					previous.profile === profile &&
					previous.version === version - 1 &&
					event.verId === version &&
					changes.length <= 256 &&
					characters <= performanceLimits.patchCharacters
				) {
					worker.postMessage({
						id: 0,
						method: "patch",
						documentId: model.id,
						baseVersion: previous.version,
						version,
						changes,
					});
					this.synced.set(model, { worker, key, profile, version });
					this.patchSyncs++;
					this.synchronizedCharacters += characters;
				} else this.synced.delete(model);
				return;
			}
			if (this.registryVersion !== registryVersion) {
				worker.postMessage({
					id: 0,
					method: "languages",
					languages: embeddedLanguages(),
				});
				this.registryVersion = registryVersion;
			}
			const text = model.getValue({ eol: "\n" });
			worker.postMessage({
				id: 0,
				method: "sync",
				document: {
					id: model.id,
					uri: model.uri.toString(),
					text,
					version,
					language: model.getLanguageId(),
					profile: languageProfile(
						model.getLanguageId(),
						model.getOptions().tabSize,
					),
				},
			});
			this.synced.set(model, { worker, key, profile, version });
			this.fullSyncs++;
			this.synchronizedCharacters += text.length;
		} catch (error) {
			this.fail(
				error instanceof Error ? error : new Error(String(error)),
			);
			if (!event) throw error;
		}
	}
	attach(model: TextModel): Disposable {
		let entry = this.models.get(model);
		if (entry) entry.references++;
		else {
			entry = { references: 1, subscriptions: [] };
			this.models.set(model, entry);
			entry.subscriptions.push(
				model.onDidChangeContent((event) => this.sync(model, event)),
				model.onDidChangeLanguage(() => this.synced.delete(model)),
				model.onDidChangeOptions(() => this.synced.delete(model)),
				model.onWillDispose(() => this.remove(model)),
			);
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
		for (const [id, pending] of this.pending)
			if (pending.model === model) {
				this.pending.delete(id);
				pending.cleanup();
				pending.reject(
					new DOMException("Document closed.", "AbortError"),
				);
			}
		if (!this.models.size) {
			this.fail(new Error("Language workspace closed."), false);
			return;
		}
		try {
			this.worker?.postMessage({
				id: 0,
				method: "close",
				documentId: model.id,
			});
		} catch (error) {
			this.fail(
				error instanceof Error ? error : new Error(String(error)),
			);
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
		if (model.isDisposed())
			return Promise.reject(new Error("Document disposed."));
		if (this.pending.size >= performanceLimits.workerPending)
			return Promise.reject(new Error("Language service is busy."));
		if (this.inFlight.size >= performanceLimits.workerInFlight)
			this.fail(
				new Error(
					"Language worker queue exhausted; restart on next request.",
				),
			);
		return new Promise<T>((resolve, reject) => {
			let worker: Worker;
			try {
				worker = this.ensure();
				this.sync(model);
			} catch (error) {
				reject(
					error instanceof Error ? error : new Error(String(error)),
				);
				return;
			}
			const id = ++this.sequence;
			const abort = () => {
				const entry = this.pending.get(id);
				if (!entry) return;
				this.pending.delete(id);
				entry.cleanup();
				entry.reject(new DOMException("Cancelled", "AbortError"));
				try {
					worker.postMessage({
						id: 0,
						method: "cancel",
						requestId: id,
					});
				} catch (error) {
					if (this.worker === worker)
						this.fail(
							error instanceof Error
								? error
								: new Error(String(error)),
						);
				}
			};
			signal.addEventListener("abort", abort, { once: true });
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				model,
				cleanup: () => signal.removeEventListener("abort", abort),
			});
			// This watchdog survives caller cancellation: a blocked synchronous tokenizer cannot process cancel.
			this.inFlight.set(
				id,
				setTimeout(() => {
					if (this.worker === worker)
						this.fail(
							new Error(
								"Language worker timed out. Run the command again to restart it.",
							),
						);
				}, performanceLimits.workerTimeoutMs),
			);
			try {
				worker.postMessage({
					...extra,
					id,
					method,
					documentId: model.id,
					version: model.getVersionId(),
					offset,
				});
			} catch (error) {
				if (this.worker === worker)
					this.fail(
						error instanceof Error
							? error
							: new Error(String(error)),
					);
			}
		});
	}
}
export const languageEngine = new LanguageEngine();
export function getLanguageWorkerStatistics(): LanguageWorkerStatistics {
	return languageEngine.statistics();
}
