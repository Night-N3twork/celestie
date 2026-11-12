export type {
	DiffChange,
	DiffCharacterChange,
	DiffComputationOptions,
	DiffEditorOptions,
	DiffModels,
	DiffRange,
	DiffResult,
	DiffSnapshot,
	DiffState,
} from "./api/diff";
export type {
	EditorOptions,
	EditorViewOptions,
	EditorViewport,
	EditorViewState,
} from "./api/editor-options";
export type {
	ColorPresentation,
	CompletionList,
	ContributionProvider,
	Documentation,
	DocumentHighlight,
	DocumentLink,
	InlayHintPart,
	InlineCompletion,
	InlineCompletionList,
	LanguageTrigger,
	LinkedEditingRanges,
	OffsetRange,
	ParameterInformation,
	ProviderModel,
	ProviderWorkspace,
	RenamePreparation,
	SelectionRange,
	SemanticTokenDelta,
	SemanticTokenSnapshot,
	SignatureHelp,
	SignatureInformation,
} from "./api/language-contributions";
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
	EditorPerformanceState,
	LanguageWorkerStatistics,
} from "./api/performance";
export type {
	LineTokenizationResult,
	TokenizationContext,
	TokenizerRegistration,
	WorkerTokenizer,
} from "./api/tokenization";
export { registerLanguageTokenizer } from "./api/tokenization";
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
export { computeDiff } from "./diff/client";
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
export { getLanguageWorkerStatistics } from "./languages/client";
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
export { DiffEditorView } from "./view/diff-editor-view";
export { EditorView } from "./view/editor-view";
export type {
	ContentWidgetOptions,
	ContentWidgetPlacement,
	OverlayWidgetOptions,
	OverlayWidgetPosition,
	ViewZone,
	ViewZoneOptions,
	WidgetFocusPolicy,
} from "./view/widget-layer";
