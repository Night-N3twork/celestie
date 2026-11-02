import type { EditHistoryOptions, HistoryViewState } from "../api/types";

interface HistoryEntry {
	readonly before: string;
	readonly after: string;
	readonly beforeState: HistoryViewState | undefined;
	readonly afterState: HistoryViewState | undefined;
	readonly group: string | undefined;
}

function snapshotState(
	state: HistoryViewState | undefined,
): HistoryViewState | undefined {
	return state
		? Object.freeze({
				...state,
				selection: Object.freeze({ ...state.selection }),
			})
		: undefined;
}

export class History {
	private readonly undoEntries: HistoryEntry[] = [];
	private readonly redoEntries: HistoryEntry[] = [];
	private mergeGroup: string | undefined;

	record(
		before: string,
		after: string,
		options: EditHistoryOptions = {},
	): void {
		const previous = this.undoEntries.at(-1);
		const merge =
			options.group !== undefined &&
			this.mergeGroup === options.group &&
			previous?.group === options.group &&
			previous.after === before;
		const entry: HistoryEntry = {
			before: merge ? previous.before : before,
			after,
			beforeState: merge
				? previous.beforeState
				: snapshotState(options.before),
			afterState: snapshotState(options.after),
			group: options.group,
		};
		if (merge) this.undoEntries.pop();
		if (entry.before !== entry.after) this.undoEntries.push(entry);
		if (this.undoEntries.length > 100) this.undoEntries.shift();
		this.redoEntries.length = 0;
		this.mergeGroup =
			entry.before === entry.after ? undefined : options.group;
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
		const entry = this.undoEntries.pop();
		if (entry) this.redoEntries.push(entry);
	}

	redo(): void {
		this.mergeGroup = undefined;
		const entry = this.redoEntries.pop();
		if (entry) this.undoEntries.push(entry);
	}

	clear(): void {
		this.mergeGroup = undefined;
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
	}
}
