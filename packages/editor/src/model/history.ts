interface HistoryEntry {
	readonly before: string;
	readonly after: string;
}

export class History {
	private readonly undoEntries: HistoryEntry[] = [];
	private readonly redoEntries: HistoryEntry[] = [];

	record(before: string, after: string): void {
		this.undoEntries.push({ before, after });
		if (this.undoEntries.length > 100) this.undoEntries.shift();
		this.redoEntries.length = 0;
	}

	undoable(): boolean {
		return this.undoEntries.length > 0;
	}

	redoable(): boolean {
		return this.redoEntries.length > 0;
	}

	peekUndo(): string | undefined {
		return this.undoEntries.at(-1)?.before;
	}

	peekRedo(): string | undefined {
		return this.redoEntries.at(-1)?.after;
	}

	undo(): void {
		const entry = this.undoEntries.pop();
		if (entry) this.redoEntries.push(entry);
	}

	redo(): void {
		const entry = this.redoEntries.pop();
		if (entry) this.undoEntries.push(entry);
	}

	clear(): void {
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
	}
}
