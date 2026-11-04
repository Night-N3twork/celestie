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
	LanguageServiceSettings,
	Location,
	SymbolInformation,
	Token,
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
export { type EditorTheme, registerTheme } from "./features/themes";
export {
	configureLanguageServices,
	LanguageWorkspace,
} from "./languages/client";
export { defaultModelRegistry, ModelRegistry } from "./model/model-registry";
export {
	type EndOfLine,
	type ModelOptions,
	type ModelSearchOptions,
	type ModelWord,
	TextModel,
	type TextModelOptions,
	type ValueOptions,
} from "./model/text-model";
export type {
	RangeStickiness,
	TrackedRange,
	TrackedRangeOptions,
} from "./model/tracked-ranges";
