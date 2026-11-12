import type { EditorPerformanceState } from "../api/performance";
import type { TextModel } from "../model/text-model";
export const performanceLimits = Object.freeze({
	languageCharacters: 600_000,
	languageLines: 20_000,
	workerTimeoutMs: 10_000,
	workerPending: 32,
	workerInFlight: 64,
	patchCharacters: 262_144,
	overviewMarkers: 2000,
});
export function editorPerformance(
	model: TextModel,
	optimizationsEnabled = true,
): EditorPerformanceState {
	const characters = model.getValueLength({ eol: "\n" }),
		lines = model.getLineCount();
	return {
		mode:
			optimizationsEnabled &&
			(characters > performanceLimits.languageCharacters ||
				lines > performanceLimits.languageLines)
				? "reduced"
				: "full",
		characters,
		lines,
		optimizationsEnabled,
	};
}
