import type {
	ContentChange,
	EditHistoryOptions,
	HistoryViewState,
} from "../api/types";
import { copyText } from "./text-utils";

export interface HistoryBatch {
	readonly forward: readonly ContentChange[];
	readonly inverse: readonly ContentChange[];
}
export interface HistoryEntry {
	readonly batches: readonly HistoryBatch[];
	readonly beforeState: HistoryViewState | undefined;
	readonly afterState: HistoryViewState | undefined;
	readonly beforeVersion: number;
	readonly afterVersion: number;
	readonly beforeEOL: string;
	readonly afterEOL: string;
	readonly group: string | undefined;
	readonly bytes: number;
}

function state(
	value: HistoryViewState | undefined,
): HistoryViewState | undefined {
	return value
		? Object.freeze({
				...value,
				selection: Object.freeze({ ...value.selection }),
			})
		: undefined;
}
function changes(values: readonly ContentChange[]): readonly ContentChange[] {
	return Object.freeze(
		values.map((value) =>
			Object.freeze({ ...value, text: copyText(value.text) }),
		),
	);
}

export class History {
	private readonly undoEntries: HistoryEntry[] = [];
	private readonly redoEntries: HistoryEntry[] = [];
	private mergeGroup: string | undefined;
	private stop = false;
	constructor(
		private limit = 100,
		private byteLimit = 16 * 1024 * 1024,
	) {
		this.setLimits(limit, byteLimit);
	}

	record(
		batch: HistoryBatch,
		options: EditHistoryOptions,
		beforeVersion: number,
		afterVersion: number,
		beforeEOL: string,
		afterEOL: string,
	): boolean {
		const previous = this.undoEntries.at(-1);
		const merge =
			options.group !== undefined &&
			this.mergeGroup === options.group &&
			previous?.group === options.group &&
			previous.afterVersion === beforeVersion &&
			previous.afterEOL === beforeEOL;
		const bytes = [...batch.forward, ...batch.inverse].reduce(
			(total, change) => total + change.text.length * 2 + 96,
			256,
		);
		const totalBytes = bytes + (merge ? previous.bytes : 0);
		if (totalBytes > this.byteLimit || !this.limit) {
			this.clear();
			return false;
		}
		const immutable = Object.freeze({
			forward: changes(batch.forward),
			inverse: changes(batch.inverse),
		});
		const entry: HistoryEntry = Object.freeze({
			batches: Object.freeze([
				...(merge ? previous.batches : []),
				immutable,
			]),
			beforeState: merge ? previous.beforeState : state(options.before),
			afterState: state(options.after),
			beforeVersion: merge ? previous.beforeVersion : beforeVersion,
			afterVersion,
			beforeEOL: merge ? previous.beforeEOL : beforeEOL,
			afterEOL,
			group: options.group,
			bytes: totalBytes,
		});
		this.redoEntries.length = 0;
		if (merge) this.undoEntries.pop();
		this.undoEntries.push(entry);
		this.mergeGroup = options.group;
		this.stop = false;
		this.trim();
		return true;
	}
	undoable(): boolean {
		return this.undoEntries.length > 0;
	}
	redoable(): boolean {
		return this.redoEntries.length > 0;
	}
	peekUndo(): HistoryEntry | undefined {
		return this.undoEntries.at(-1);
	}
	peekRedo(): HistoryEntry | undefined {
		return this.redoEntries.at(-1);
	}
	undo(): void {
		this.mergeGroup = undefined;
		this.stop = false;
		const entry = this.undoEntries.pop();
		if (entry) this.redoEntries.push(entry);
	}
	redo(): void {
		this.mergeGroup = undefined;
		this.stop = false;
		const entry = this.redoEntries.pop();
		if (entry) this.undoEntries.push(entry);
	}
	pushStop(): void {
		this.mergeGroup = undefined;
		this.stop = true;
	}
	popStop(): boolean {
		if (!this.stop || this.redoEntries.length) return false;
		this.mergeGroup = this.undoEntries.at(-1)?.group;
		this.stop = false;
		return true;
	}
	clear(): void {
		this.mergeGroup = undefined;
		this.stop = false;
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
	}
	getStats(): {
		undoEntries: number;
		redoEntries: number;
		bytes: number;
		byteLimit: number;
		limit: number;
	} {
		return {
			undoEntries: this.undoEntries.length,
			redoEntries: this.redoEntries.length,
			bytes: [...this.undoEntries, ...this.redoEntries].reduce(
				(total, entry) => total + entry.bytes,
				0,
			),
			byteLimit: this.byteLimit,
			limit: this.limit,
		};
	}
	setLimits(limit: number, byteLimit: number): void {
		if (
			!Number.isSafeInteger(limit) ||
			limit < 0 ||
			!Number.isSafeInteger(byteLimit) ||
			byteLimit < 0
		)
			throw new RangeError(
				"History limits must be non-negative safe integers.",
			);
		this.limit = limit;
		this.byteLimit = byteLimit;
		this.trim();
	}
	private trim(): void {
		while (
			this.undoEntries.length + this.redoEntries.length > this.limit ||
			this.getStats().bytes > this.byteLimit
		) {
			if (this.undoEntries.length) this.undoEntries.shift();
			else if (this.redoEntries.length) this.redoEntries.shift();
			else break;
		}
	}
}
