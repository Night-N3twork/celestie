import type { Disposable } from "../api/types";
import { createEditorWorker } from "../api/workers";
import type { SearchMatch, SearchOptions } from "./search";

export interface RegexSearchRequest {
	readonly id: number;
	readonly text: string;
	readonly query: string;
	readonly options: SearchOptions;
}
export interface RegexSearchResponse {
	readonly id: number;
	readonly matches: readonly SearchMatch[];
	readonly truncated: boolean;
	readonly error?: string;
}

export class RegexSearch implements Disposable {
	private worker: Worker | undefined;
	private sequence = 0;
	private pending:
		| {
				id: number;
				reject: (error: Error) => void;
				timer: ReturnType<typeof setTimeout>;
		  }
		| undefined;
	private disposed = false;

	search(
		text: string,
		query: string,
		options: SearchOptions,
	): Promise<RegexSearchResponse> {
		if (this.disposed) return Promise.reject(new Error("Search disposed."));
		this.cancel();
		return new Promise((resolve, reject) => {
			try {
				const worker =
					this.worker ??
					createEditorWorker(
						"search",
						() =>
							new Worker(
								new URL(
									"../workers/search.worker.ts",
									import.meta.url,
								),
								{ type: "module" },
							),
					);
				this.worker = worker;
				const id = ++this.sequence;
				const timer = setTimeout(
					() =>
						this.cancel(
							"Regex search exceeded one second. Simplify the pattern.",
						),
					1000,
				);
				this.pending = { id, reject, timer };
				worker.onmessage = (
					event: MessageEvent<RegexSearchResponse>,
				) => {
					if (this.pending?.id !== id) return;
					if (
						!event.data ||
						typeof event.data !== "object" ||
						!Number.isInteger(event.data.id)
					) {
						this.cancel("Invalid search worker response.");
						return;
					}
					if (event.data.id !== id) return;
					clearTimeout(timer);
					this.pending = undefined;
					worker.onmessage = null;
					if (
						!Array.isArray(event.data.matches) ||
						typeof event.data.truncated !== "boolean" ||
						event.data.matches.length > 10000 ||
						!event.data.matches.every(
							(match) =>
								match &&
								Number.isInteger(match.from) &&
								Number.isInteger(match.to) &&
								match.from >= 0 &&
								match.to >= match.from &&
								match.to <= text.length &&
								match.range &&
								Number.isInteger(match.range.startLine) &&
								match.range.startLine >= 1 &&
								Number.isInteger(match.range.endLine) &&
								match.range.endLine >= match.range.startLine &&
								Number.isInteger(match.range.startColumn) &&
								match.range.startColumn >= 1 &&
								Number.isInteger(match.range.endColumn) &&
								match.range.endColumn >= 1,
						)
					) {
						worker.terminate();
						if (this.worker === worker) this.worker = undefined;
						worker.onerror = null;
						worker.onmessageerror = null;
						reject(new Error("Invalid search worker response."));
						return;
					}
					resolve(event.data);
				};
				worker.onerror = (event) => {
					event.preventDefault();
					this.cancel("Regex search worker failed. Try again.");
					worker.terminate();
					if (this.worker === worker) this.worker = undefined;
				};
				worker.onmessageerror = () => {
					this.cancel("Invalid search worker message.");
					worker.terminate();
					if (this.worker === worker) this.worker = undefined;
				};
				worker.postMessage({
					id,
					text,
					query,
					options,
				} satisfies RegexSearchRequest);
			} catch (error) {
				this.cancel(
					error instanceof Error
						? error.message
						: "Regex search is unavailable.",
				);
				reject(
					error instanceof Error
						? error
						: new Error("Regex search is unavailable."),
				);
			}
		});
	}

	cancel(message = "Search canceled."): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = undefined;
		clearTimeout(pending.timer);
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		this.worker = undefined;
		pending.reject(new Error(message));
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
		this.worker?.terminate();
		this.worker = undefined;
	}
}
