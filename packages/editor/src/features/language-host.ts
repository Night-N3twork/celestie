import type {
	Analysis,
	Completion,
	Diagnostic,
	LanguageEdit,
	Location,
} from "../api/languages";
import type { TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
export interface LanguageFeatureHost {
	readonly frame: HTMLElement;
	readonly input: HTMLTextAreaElement;
	readonly viewport: HTMLElement;
	model(): TextModel | null;
	selection(): TextSelection;
	canEdit(): boolean;
	diagnostics(): readonly Diagnostic[];
	analysisOptions(): { inlayHints: boolean; codeLens: boolean };
	point(offset: number): { x: number; y: number; height: number };
	offsetAtPoint(x: number, y: number): number;
	analysis(value: Analysis): void;
	apply(edits: readonly LanguageEdit[]): void;
	accept(item: Completion): void;
	snippet(body: string): void;
	nextSnippet(backward: boolean): boolean;
	cancelSnippet(): void;
	open(location: Location): void;
	announce(message: string): void;
}
