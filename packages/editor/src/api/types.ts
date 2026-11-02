export interface Position {
	readonly line: number;
	readonly column: number;
}

export interface Range {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

export interface TextEdit {
	readonly range: Range;
	readonly text: string;
}

export interface TextSelection {
	readonly start: number;
	readonly end: number;
	readonly direction: "forward" | "backward" | "none";
}

export interface HistoryViewState {
	readonly owner: string;
	readonly selection: TextSelection;
	readonly scrollTop: number;
	readonly scrollLeft: number;
}

export interface EditHistoryOptions {
	readonly before?: HistoryViewState;
	readonly after?: HistoryViewState;
	readonly group?: string;
}

export interface ContentChange {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

export interface ModelChangeEvent {
	readonly verId: number;
	readonly changes: readonly ContentChange[];
	readonly undoing: boolean;
	readonly redoing: boolean;
	readonly flush: boolean;
	readonly historyState?: HistoryViewState;
}

export interface Disposable {
	dispose(): void;
}
