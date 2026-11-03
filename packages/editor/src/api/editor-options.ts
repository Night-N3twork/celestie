import type { IndentationOptions } from "../features/indentation-options";
import type { LanguageConfiguration } from "../languages/configuration";
import type { TextSelection } from "./types";

export interface EditorOptions extends IndentationOptions {
	readonly readOnly: boolean;
	readonly tabFocusMode: boolean;
	readonly accessibilitySupport: "auto" | "on" | "off";
}

export interface EditorViewOptions extends Partial<EditorOptions> {
	readonly ariaLabel?: string;
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
