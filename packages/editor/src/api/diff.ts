import type { TextModel } from "../model/text-model";
import type { EditorViewOptions } from "./editor-options";
export interface DiffRange {
	readonly from: number;
	readonly to: number;
}
export interface DiffCharacterChange {
	readonly original: DiffRange;
	readonly modified: DiffRange;
}
export interface DiffChange {
	readonly originalStart: number;
	readonly originalEnd: number;
	readonly modifiedStart: number;
	readonly modifiedEnd: number;
	readonly original: DiffRange;
	readonly modified: DiffRange;
	readonly characters: readonly DiffCharacterChange[];
}
export interface DiffMove {
	readonly id: number;
	readonly originalStart: number;
	readonly originalEnd: number;
	readonly modifiedStart: number;
	readonly modifiedEnd: number;
	readonly original: DiffRange;
	readonly modified: DiffRange;
}
export interface DiffComputationOptions {
	readonly detectMoves?: boolean;
	readonly ignoreTrimWhitespace?: boolean;
	readonly maxComputationTimeMs?: number;
	readonly maxFileSize?: number;
	readonly maxLines?: number;
	readonly maxWork?: number;
}
export interface DiffResult {
	readonly moves?: readonly DiffMove[];
	readonly changes: readonly DiffChange[];
	readonly identical: boolean;
	readonly quitEarly: boolean;
	readonly reason?: "size" | "time" | "work" | "changes";
}
export interface DiffModels {
	readonly original: TextModel;
	readonly modified: TextModel;
}
export interface DiffEditorOptions extends DiffComputationOptions {
	readonly mode?: "side-by-side" | "inline";
	readonly readOnly?: boolean;
	readonly hideUnchangedRegions?: boolean;
	readonly contextLines?: number;
	readonly originalLabel?: string;
	readonly modifiedLabel?: string;
	readonly editorOptions?: EditorViewOptions;
}
export interface DiffSnapshot extends DiffResult {
	readonly originalVersion: number;
	readonly modifiedVersion: number;
}
export interface DiffState {
	readonly status: "empty" | "loading" | "ready" | "error";
	readonly result?: DiffSnapshot;
	readonly message?: string;
}
