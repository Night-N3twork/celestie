import type {
	CodeAction,
	CodeLens,
	Completion,
	Diagnostic,
	DocumentColor,
	InlayHint,
	LanguageContext,
	LanguageEdit,
	Location,
	Token,
} from "./languages";
import type { Disposable } from "./types";

export type Documentation = string | { readonly markdown: string };
export interface OffsetRange {
	readonly from: number;
	readonly to: number;
}
export interface ProviderModel {
	readonly uri: string;
	readonly text: string;
	readonly version: number;
	readonly language: string;
}
export interface ProviderWorkspace {
	models(): readonly ProviderModel[];
	resolve(
		uri: string,
		signal: AbortSignal,
	): ProviderModel | undefined | Promise<ProviderModel | undefined>;
}
export interface LanguageTrigger {
	readonly kind: "invoke" | "character" | "incomplete";
	readonly character?: string;
}
export interface CompletionList {
	readonly items: readonly Completion[];
	readonly incomplete?: boolean;
}
export interface SemanticTokenSnapshot {
	readonly resultId?: string;
	readonly tokens: readonly Token[];
}
export interface SemanticTokenDelta {
	readonly resultId: string;
	readonly edits: readonly {
		readonly start: number;
		readonly deleteCount: number;
		readonly tokens?: readonly Token[];
	}[];
}
export interface ParameterInformation {
	readonly label: string | readonly [number, number];
	readonly documentation?: Documentation;
}
export interface SignatureInformation {
	readonly label: string;
	readonly parameters?: readonly ParameterInformation[];
	readonly documentation?: Documentation;
	readonly activeParameter?: number;
}
export interface SignatureHelp {
	readonly signatures: readonly SignatureInformation[];
	readonly activeSignature?: number;
	readonly activeParameter?: number;
}
export interface InlineCompletion extends OffsetRange {
	readonly insertText: string;
	readonly additionalEdits?: readonly LanguageEdit[];
	readonly label?: string;
}
export interface InlineCompletionList extends Disposable {
	readonly items: readonly InlineCompletion[];
}
export interface DocumentHighlight extends OffsetRange {
	readonly kind?: "text" | "read" | "write";
}
export interface LinkedEditingRanges {
	readonly ranges: readonly OffsetRange[];
	readonly wordPattern?: RegExp;
}
export interface DocumentLink extends OffsetRange {
	readonly target?: string;
	readonly tooltip?: string;
	readonly data?: unknown;
}
export interface SelectionRange extends OffsetRange {
	readonly parent?: SelectionRange;
}
export interface RenamePreparation extends OffsetRange {
	readonly placeholder?: string;
	readonly reason?: string;
}
export interface ColorPresentation {
	readonly label: string;
	readonly edits: readonly LanguageEdit[];
}
export interface InlayHintPart {
	readonly text: string;
	readonly tooltip?: string;
	readonly command?: string;
	readonly location?: Location;
}
export interface ContributionProvider {
	readonly completionTriggerCharacters?: readonly string[];
	readonly signatureTriggerCharacters?: readonly string[];
	readonly onTypeFormattingCharacters?: readonly string[];
	onDidChange?(listener: () => void): Disposable;
	declarations?(
		context: LanguageContext,
	): readonly Location[] | Promise<readonly Location[]>;
	typeDefinitions?(
		context: LanguageContext,
	): readonly Location[] | Promise<readonly Location[]>;
	implementations?(
		context: LanguageContext,
	): readonly Location[] | Promise<readonly Location[]>;
	documentHighlights?(
		context: LanguageContext,
	): readonly DocumentHighlight[] | Promise<readonly DocumentHighlight[]>;
	linkedEditing?(
		context: LanguageContext,
	): LinkedEditingRanges | null | Promise<LinkedEditingRanges | null>;
	links?(
		context: LanguageContext,
	): readonly DocumentLink[] | Promise<readonly DocumentLink[]>;
	resolveLink?(
		context: LanguageContext,
		link: DocumentLink,
	): DocumentLink | null | Promise<DocumentLink | null>;
	selectionRanges?(
		context: LanguageContext,
		offsets: readonly number[],
	): readonly SelectionRange[] | Promise<readonly SelectionRange[]>;
	onTypeFormat?(
		context: LanguageContext,
		character: string,
	): readonly LanguageEdit[] | Promise<readonly LanguageEdit[]>;
	inlineCompletions?(
		context: LanguageContext,
	):
		| readonly InlineCompletion[]
		| InlineCompletionList
		| Promise<readonly InlineCompletion[] | InlineCompletionList>;
	prepareRename?(
		context: LanguageContext,
	): RenamePreparation | null | Promise<RenamePreparation | null>;
	resolveAction?(
		context: LanguageContext,
		action: CodeAction,
	): CodeAction | null | Promise<CodeAction | null>;
	semanticTokens?(
		context: LanguageContext,
	):
		| readonly Token[]
		| SemanticTokenSnapshot
		| SemanticTokenDelta
		| Promise<
				readonly Token[] | SemanticTokenSnapshot | SemanticTokenDelta
		  >;
	diagnostics?(
		context: LanguageContext,
	): readonly Diagnostic[] | Promise<readonly Diagnostic[]>;
	foldingRanges?(
		context: LanguageContext,
	):
		| readonly { start: number; end: number }[]
		| Promise<readonly { start: number; end: number }[]>;
	documentSymbols?(
		context: LanguageContext,
	):
		| readonly import("./languages").SymbolInformation[]
		| Promise<readonly import("./languages").SymbolInformation[]>;
	documentColors?(
		context: LanguageContext,
	): readonly DocumentColor[] | Promise<readonly DocumentColor[]>;
	inlayHints?(
		context: LanguageContext,
	): readonly InlayHint[] | Promise<readonly InlayHint[]>;
	resolveInlayHint?(
		context: LanguageContext,
		hint: InlayHint,
	): InlayHint | null | Promise<InlayHint | null>;
	codeLenses?(
		context: LanguageContext,
	): readonly CodeLens[] | Promise<readonly CodeLens[]>;
	resolveCodeLens?(
		context: LanguageContext,
		lens: CodeLens,
	): CodeLens | null | Promise<CodeLens | null>;
	colorPresentations?(
		context: LanguageContext,
		color: DocumentColor,
		value: string,
	): readonly ColorPresentation[] | Promise<readonly ColorPresentation[]>;
}
