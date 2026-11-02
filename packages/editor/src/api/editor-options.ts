import type { IndentationOptions } from "../features/indentation-options";
import type { LanguageConfiguration } from "../languages/configuration";

export interface EditorOptions extends IndentationOptions {
	readonly readOnly: boolean;
	readonly tabFocusMode: boolean;
}

export interface EditorViewOptions extends Partial<EditorOptions> {
	readonly languageConfiguration?: LanguageConfiguration;
	readonly detectIndentation?: boolean;
}
