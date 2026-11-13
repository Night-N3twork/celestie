import type { DiffComputationOptions, DiffEditorOptions } from "../api/diff";
export const computationDefaults = {
	ignoreTrimWhitespace: false,
	detectMoves: true,
	maxComputationTimeMs: 1000,
	maxFileSize: 4_000_000,
	maxLines: 200_000,
	maxWork: 2_000_000,
} as const;
export function computationOptions(options: DiffComputationOptions) {
	const result = {
		detectMoves: options.detectMoves ?? computationDefaults.detectMoves,
		ignoreTrimWhitespace:
			options.ignoreTrimWhitespace ??
			computationDefaults.ignoreTrimWhitespace,
		maxComputationTimeMs:
			options.maxComputationTimeMs ??
			computationDefaults.maxComputationTimeMs,
		maxFileSize: options.maxFileSize ?? computationDefaults.maxFileSize,
		maxLines: options.maxLines ?? computationDefaults.maxLines,
		maxWork: options.maxWork ?? computationDefaults.maxWork,
	};
	if (
		typeof result.ignoreTrimWhitespace !== "boolean" ||
		typeof result.detectMoves !== "boolean"
	)
		throw new TypeError("ignoreTrimWhitespace must be a boolean.");
	for (const [name, value, min, max] of [
		["maxComputationTimeMs", result.maxComputationTimeMs, 10, 30_000],
		["maxFileSize", result.maxFileSize, 1, 20_000_000],
		["maxLines", result.maxLines, 1, 1_000_000],
		["maxWork", result.maxWork, 1, 20_000_000],
	] as const)
		if (!Number.isInteger(value) || value < min || value > max)
			throw new RangeError(
				`${name} must be an integer between ${min} and ${max}.`,
			);
	return result;
}
export function diffOptions(options: DiffEditorOptions) {
	computationOptions(options);
	const result = {
		mode: "side-by-side",
		readOnly: false,
		hideUnchangedRegions: false,
		contextLines: 3,
		originalLabel: "Original",
		modifiedLabel: "Modified",
		...options,
	} as const;
	if (
		!["side-by-side", "inline"].includes(result.mode) ||
		typeof result.readOnly !== "boolean" ||
		typeof result.hideUnchangedRegions !== "boolean" ||
		!Number.isInteger(result.contextLines) ||
		result.contextLines < 1 ||
		result.contextLines > 100
	)
		throw new TypeError("Invalid diff view options.");
	return result;
}
