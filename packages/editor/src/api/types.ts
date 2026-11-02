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
}

export interface Disposable {
	dispose(): void;
}
