import type { DiffComputationOptions, DiffResult } from "../api/diff";
import { calculateDiff } from "../diff/load";
export interface DiffRequest {
	readonly original: string;
	readonly modified: string;
	readonly options: DiffComputationOptions;
}
export type DiffResponse =
	| { readonly result: DiffResult }
	| { readonly error: string };
const channel = globalThis as unknown as {
	onmessage: (event: MessageEvent<DiffRequest>) => void;
	postMessage(response: DiffResponse): void;
};
channel.onmessage = ({ data }) => {
	try {
		channel.postMessage({
			result: calculateDiff(data.original, data.modified, data.options),
		});
	} catch (error) {
		channel.postMessage({
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
