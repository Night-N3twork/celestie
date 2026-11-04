import { getLanguage, type LanguageServiceSettings } from "../api/languages";
import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	cleanup(): void;
}
class LanguageEngine {
	private worker: Worker | undefined;
	private sequence = 0;
	private settings: LanguageServiceSettings = {};
	private configurationError = "";
	configure(settings: LanguageServiceSettings): void {
		this.settings = structuredClone(settings);
		this.configurationError = "";
		this.worker?.postMessage({
			id: 0,
			method: "configure",
			settings: this.settings,
		});
	}
	private readonly pending = new Map<number, Pending>();
	private readonly models = new Map<
		TextModel,
		{ references: number; subscriptions: Disposable[] }
	>();
	private filename(model: TextModel): string {
		const extension =
			model.getLanguageId() === "javascript"
				? ".js"
				: model.getLanguageId().startsWith("json")
					? ".json"
					: ".ts";
		const path = model.uri.path || `/${model.id}${extension}`;
		return `/workspace${path.startsWith("/") ? path : `/${path}`}`;
	}
	private ensure(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(
			new URL("../workers/languages.worker.ts", import.meta.url),
			{ type: "module" },
		);
		this.worker = worker;
		worker.postMessage({
			id: 0,
			method: "configure",
			settings: this.settings,
		});
		worker.onmessage = (event) => {
			const message = event.data as {
				id: number;
				result?: unknown;
				error?: string;
			};
			if (message.id === 0 && message.error)
				this.configurationError = message.error;
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
		this.worker?.postMessage({
			id: 0,
			method: "sync",
			document: {
				id: model.id,
				uri: model.uri.toString(),
				text: model.getValue({ eol: "\n" }),
				version: model.getVersionId(),
				language: model.getLanguageId(),
				keywords: getLanguage(model.getLanguageId())?.keywords ?? [],
				file: this.filename(model),
			},
		});
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
		if (this.configurationError)
			return Promise.reject(new Error(this.configurationError));
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
				reject(new DOMException("Cancelled", "AbortError"));
			};
			signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(() => {
				this.pending.delete(id);
				signal.removeEventListener("abort", abort);
				reject(new Error("Language request timed out."));
			}, 10000);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
				cleanup: () => signal.removeEventListener("abort", abort),
			});
			worker.postMessage({
				id,
				method,
				documentId: model.id,
				offset,
				options: model.getOptions(),
				...extra,
			});
		});
	}
}
export const languageEngine = new LanguageEngine();
export class LanguageWorkspace implements Disposable {
	private readonly attachments: Disposable[] = [];
	constructor(models: readonly TextModel[]) {
		for (const model of models)
			this.attachments.push(languageEngine.attach(model));
	}
	dispose(): void {
		for (const attachment of this.attachments.splice(0))
			attachment.dispose();
	}
}

export function configureLanguageServices(
	settings: LanguageServiceSettings,
): void {
	languageEngine.configure(settings);
}
