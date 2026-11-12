export interface EditorPerformanceState {
	readonly mode: "full" | "reduced";
	readonly characters: number;
	readonly lines: number;
	readonly optimizationsEnabled: boolean;
}
export interface LanguageWorkerStatistics {
	readonly running: boolean;
	readonly attachedModels: number;
	readonly pendingRequests: number;
	readonly inFlightRequests: number;
	readonly starts: number;
	readonly failures: number;
	readonly fullSyncs: number;
	readonly patchSyncs: number;
	readonly synchronizedCharacters: number;
}
