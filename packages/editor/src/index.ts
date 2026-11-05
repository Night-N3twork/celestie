export type {
	EditorOptions,
	EditorViewOptions,
	EditorViewState,
} from "./api/editor-options";
export type {
	Analysis,
	CodeAction,
	CodeLens,
	Completion,
	Diagnostic,
	DocumentColor,
	Hover,
	InlayHint,
	LanguageContext,
	LanguageDefinition,
	LanguageEdit,
	LanguageProvider,
	Location,
	SymbolInformation,
	Token,
	WorkspaceEdit,
	WorkspaceFileOperation,
} from "./api/languages";
export {
	detectLanguage,
	getLanguages,
	registerLanguage,
	registerLanguageProvider,
} from "./api/languages";
export type {
	ContentChange,
	Disposable,
	EditHistoryOptions,
	HistoryViewState,
	InputMappingSegment,
	ModelChangeEvent,
	Position,
	Range,
	TextEdit,
	TextSelection,
} from "./api/types";
export { Uri, type UriComponents } from "./api/uri";
export type { TransferContext, TransferProvider } from "./features/clipboard";
export type { EditorCommand } from "./features/commands";
export type { Decoration, VisibleDecoration } from "./features/decorations";
export { DecorationCollection } from "./features/decorations";
export type { IndentationOptions } from "./features/indentation-options";
export {
	type EditorTheme,
	type ResolvedTokenStyle,
	registerTheme,
	resolveTokenStyle,
	type ThemeKind,
	type TokenStyle,
} from "./features/themes";
export { defaultModelRegistry, ModelRegistry } from "./model/model-registry";
export {
	type EndOfLine,
	type ModelOptions,
	type ModelSearchOptions,
	type ModelWord,
	TextModel,
	type TextModelOptions,
	type ValueOptions,
	type WorkspaceTextEdit,
} from "./model/text-model";
export type {
	RangeStickiness,
	TrackedRange,
	TrackedRangeOptions,
} from "./model/tracked-ranges";
export type {
	ContentWidgetOptions,
	ContentWidgetPlacement,
	OverlayWidgetOptions,
	OverlayWidgetPosition,
	ViewZone,
	ViewZoneOptions,
	WidgetFocusPolicy,
} from "./view/widget-layer";
