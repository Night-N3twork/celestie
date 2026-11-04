import type { IndentationOptions } from "../features/indentation-options";
import { hasTheme } from "../features/themes";
import type { LanguageConfiguration } from "../languages/configuration";
import type { TextSelection } from "./types";

export interface EditorOptions extends IndentationOptions {
	readonly readOnly: boolean;
	readonly tabFocusMode: boolean;
	readonly accessibilitySupport: "auto" | "on" | "off";
	readonly wordWrap: "off" | "on" | "wordWrapColumn" | "bounded";
	readonly wordWrapColumn: number;
	readonly wrapIndent: "none" | "same" | "indent";
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly theme: string;
	readonly minimap: boolean;
	readonly inlayHints: boolean;
	readonly codeLens: boolean;
	readonly stickyScroll: boolean;
	readonly lineNumbers: "on" | "off" | "relative";
	readonly renderWhitespace: "none" | "all";
	readonly indentGuides: boolean;
	readonly rulers: readonly number[];
}

export interface EditorViewOptions extends Partial<EditorOptions> {
	readonly ariaLabel?: string;
	readonly onOpenLocation?: (
		location: import("./languages").Location,
	) => void;
	readonly languageConfiguration?: LanguageConfiguration;
	readonly detectIndentation?: boolean;
}

export interface EditorViewState {
	readonly modelUri?: string;
	readonly selection: TextSelection;
	readonly selections?: readonly TextSelection[];
	readonly scrollTop: number;
	readonly scrollLeft: number;
}

export const defaultViewOptions = {
	wordWrap: "off",
	wordWrapColumn: 80,
	wrapIndent: "same",
	fontFamily: "monospace",
	fontSize: 16,
	lineHeight: 24,
	theme: "dark",
	minimap: false,
	inlayHints: false,
	codeLens: false,
	stickyScroll: true,
	lineNumbers: "on",
	renderWhitespace: "none",
	indentGuides: true,
	rulers: [],
} as const;
export function validateViewOptions(options: EditorOptions): void {
	if (!hasTheme(options.theme))
		throw new Error(`Unknown editor theme: ${options.theme}`);
	for (const flag of [
		options.readOnly,
		options.tabFocusMode,
		options.minimap,
		options.inlayHints,
		options.codeLens,
		options.stickyScroll,
		options.indentGuides,
	])
		if (typeof flag !== "boolean")
			throw new TypeError("Editor flags must be booleans.");
	if (
		!["off", "on", "wordWrapColumn", "bounded"].includes(
			options.wordWrap,
		) ||
		!["none", "same", "indent"].includes(options.wrapIndent) ||
		!["on", "off", "relative"].includes(options.lineNumbers) ||
		!["none", "all"].includes(options.renderWhitespace)
	)
		throw new TypeError("Invalid layout option.");
	for (const [name, value, min, max] of [
		["wordWrapColumn", options.wordWrapColumn, 8, 10000],
		["fontSize", options.fontSize, 8, 48],
		["lineHeight", options.lineHeight, 12, 96],
	] as const)
		if (!Number.isFinite(value) || value < min || value > max)
			throw new RangeError(`${name} must be between ${min} and ${max}.`);
	if (
		options.lineHeight < options.fontSize ||
		!options.fontFamily.trim() ||
		!options.rulers.every(
			(column) => Number.isInteger(column) && column > 0,
		)
	)
		throw new TypeError(
			"Invalid font, line height, or ruler configuration.",
		);
}
