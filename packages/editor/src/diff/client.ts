import type { DiffComputationOptions, DiffResult } from "../api/diff";
import type { Disposable } from "../api/types";
import type { DiffResponse } from "../workers/diff.worker";
import { computationOptions } from "./options";
export class DiffWorkerClient implements Disposable {
	private worker: Worker | undefined;
	private cancel: (() => void) | undefined;
	private disposed = false;
	request(
		original: string,
		modified: string,
		options: DiffComputationOptions,
		signal: AbortSignal,
	): Promise<DiffResult> {
		if (this.disposed)
			return Promise.reject(new Error("Diff worker disposed."));
		this.cancel?.();
		signal.throwIfAborted();
		const config = computationOptions(options);
		return new Promise((resolve, reject) => {
			let worker: Worker;
			try {
				worker = this.worker ??= new Worker(
					new URL("../workers/diff.worker.ts", import.meta.url),
					{ type: "module" },
				);
			} catch (error) {
				reject(error);
				return;
			}
			const finish = (error?: Error, result?: DiffResult) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				this.cancel = undefined;
				if (error) {
					worker.terminate();
					this.worker = undefined;
					reject(error);
				} else if (result) resolve(result);
			};
			const abort = () =>
				finish(new DOMException("Diff cancelled.", "AbortError"));
			const timer = setTimeout(
				() => finish(new Error("Diff worker timed out.")),
				config.maxComputationTimeMs + 2000,
			);
			this.cancel = abort;
			signal.addEventListener("abort", abort, { once: true });
			worker.onmessage = ({ data }: MessageEvent<DiffResponse>) => {
				"result" in data
					? finish(undefined, data.result)
					: finish(new Error(data.error));
			};
			worker.onerror = (event) => {
				event.preventDefault();
				finish(new Error(event.message || "Diff worker failed."));
			};
			worker.onmessageerror = () =>
				finish(new Error("Invalid diff worker response."));
			try {
				worker.postMessage({ original, modified, options: config });
			} catch (error) {
				finish(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});
	}
	dispose(): void {
		this.disposed = true;
		this.cancel?.();
		this.worker?.terminate();
		this.worker = undefined;
	}
}
export async function computeDiff(
	original: string,
	modified: string,
	options: DiffComputationOptions = {},
	signal: AbortSignal = new AbortController().signal,
): Promise<DiffResult> {
	const client = new DiffWorkerClient();
	try {
		return await client.request(
			original.replace(/\r\n?|\n/g, "\n"),
			modified.replace(/\r\n?|\n/g, "\n"),
			options,
			signal,
		);
	} finally {
		client.dispose();
	}
}
