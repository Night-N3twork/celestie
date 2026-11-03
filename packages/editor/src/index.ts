export type {
	EditorOptions,
	EditorViewOptions,
	EditorViewState,
} from "./api/editor-options";
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
export type { IndentationOptions } from "./features/indentation-options";
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
