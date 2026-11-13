import type { EditorOptions } from "../api/editor-options";
import type { ProviderWorkspace } from "../api/language-contributions";
import type {
	Analysis,
	Completion,
	Diagnostic,
	LanguageEdit,
	Location,
	WorkspaceEdit,
} from "../api/languages";
import type { EditorPerformanceState } from "../api/performance";
import type { TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { DecorationCollection } from "./decorations";
export interface LanguageFeatureHost {
	readonly frame: HTMLElement;
	readonly input: HTMLTextAreaElement;
	readonly viewport: HTMLElement;
	model(): TextModel | null;
	selection(): TextSelection;
	selections(): readonly TextSelection[];
	select(values: readonly TextSelection[]): void;
	options(): EditorOptions;
	performance(): EditorPerformanceState;
	workspace(): ProviderWorkspace;
	decorations(): DecorationCollection;
	execute(id: string): Promise<boolean>;
	openLink(target: string): void;
	applyTyping(edits: readonly LanguageEdit[], version: number): void;
	canEdit(): boolean;
	diagnostics(): readonly Diagnostic[];
	analysisOptions(): {
		inlayHints: boolean;
		codeLens: boolean;
		unicodeHighlight: boolean;
		unicodeHighlightOptions: import("../api/unicode-highlights").UnicodeHighlightOptions;
	};
	point(offset: number): { x: number; y: number; height: number };
	offsetAtPoint(x: number, y: number): number;
	analysis(value: Analysis): void;
	apply(edits: readonly LanguageEdit[] | WorkspaceEdit): void | Promise<void>;
	accept(item: Completion, commitCharacter?: string): void;
	snippet(body: string): void;
	nextSnippet(backward: boolean): boolean;
	cancelSnippet(): void;
	open(location: Location): void;
	announce(message: string): void;
}
