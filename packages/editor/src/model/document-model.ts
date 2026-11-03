import type {
	ContentChange,
	Disposable,
	EditHistoryOptions,
	HistoryViewState,
	InputMappingSegment,
	ModelChangeEvent,
	Position,
	Range,
	TextEdit,
} from "../api/types";
import { Uri } from "../api/uri";
import {
	type IndentationOptions,
	resolveIndentation,
} from "../features/indentation-options";
import { findLiteralMatches, type SearchMatch } from "../features/search";
import { History } from "./change-history";
import { composeChanges, inputChanges, inputMappings } from "./change-mapping";
import { Emitter } from "./events";
import { defaultModelRegistry, type ModelRegistry } from "./model-registry";
import { TextBuffer } from "./text-buffer";
import { copyText } from "./text-utils";
import {
	type TrackedRange,
	type TrackedRangeOptions,
	TrackedRanges,
} from "./tracked-ranges";

export type EndOfLine = "\n" | "\r\n" | "\r";
export interface ModelOptions extends IndentationOptions {
	readonly historyLimit: number;
	readonly historyByteLimit: number;
}
export interface TextModelOptions extends Partial<ModelOptions> {
	readonly uri?: Uri | string;
	readonly languageId?: string;
	readonly defaultEOL?: EndOfLine;
	readonly registry?: ModelRegistry;
	readonly register?: boolean;
}
export interface ValueOptions {
	readonly eol?: EndOfLine;
	readonly preserveBOM?: boolean;
}
export interface ModelWord {
	readonly word: string;
	readonly startColumn: number;
	readonly endColumn: number;
}
export interface ModelSearchOptions {
	readonly matchCase?: boolean;
	readonly wholeWord?: boolean;
	readonly range?: Range;
	readonly limit?: number;
}
let sequence = 0;

export class DocumentModel implements Disposable {
	readonly id = `model-${++sequence}`;
	readonly uri: Uri;
	private buffer: TextBuffer;
	private readonly history: History;
	private readonly ranges = new TrackedRanges();
	private readonly content: Emitter<ModelChangeEvent>;
	private readonly optionsChanged: Emitter<ModelOptions>;
	private readonly languageChanged: Emitter<{
		readonly oldLanguageId: string;
		readonly languageId: string;
	}>;
	private readonly willDispose: Emitter<void>;
	private readonly attached: Emitter<{ readonly viewCount: number }>;
	private readonly registry: ModelRegistry | undefined;
	private readonly owners = new Set<string>();
	private options: ModelOptions;
	private languageId: string;
	private eol: EndOfLine;
	private bom: string;
	private version = 1;
	private alternativeVersion = 1;
	private nextAlternativeVersion = 1;
	private disposed = false;
	private disposing = false;
	private notifying = false;
	private computing = false;

	constructor(
		text = "",
		optionsOrReporter: TextModelOptions | ((error: unknown) => void) = {},
		reporter: (error: unknown) => void = console.error,
	) {
		if (typeof text !== "string")
			throw new TypeError("Document text must be a string.");
		const options =
			typeof optionsOrReporter === "function" ? {} : optionsOrReporter;
		const report =
			typeof optionsOrReporter === "function"
				? optionsOrReporter
				: reporter;
		this.content = new Emitter(report);
		this.optionsChanged = new Emitter(report);
		this.languageChanged = new Emitter(report);
		this.willDispose = new Emitter(report);
		this.attached = new Emitter(report);
		this.options = {
			...resolveIndentation({
				...(options.tabSize !== undefined
					? { tabSize: options.tabSize }
					: {}),
				...(options.insertSpaces !== undefined
					? { insertSpaces: options.insertSpaces }
					: {}),
			}),
			historyLimit: options.historyLimit ?? 100,
			historyByteLimit: options.historyByteLimit ?? 16 * 1024 * 1024,
		};
		this.history = new History(
			this.options.historyLimit,
			this.options.historyByteLimit,
		);
		this.bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
		this.buffer = new TextBuffer(text.slice(this.bom.length));
		if (options.defaultEOL !== undefined)
			this.assertEOL(options.defaultEOL);
		this.eol =
			(text.match(/\r\n|\r|\n/)?.[0] as EndOfLine | undefined) ??
			options.defaultEOL ??
			"\n";
		this.languageId = options.languageId ?? "plaintext";
		if (!this.languageId.trim())
			throw new Error("Language ID must not be empty.");
		this.uri =
			typeof options.uri === "string"
				? Uri.parse(options.uri)
				: (options.uri ?? Uri.parse(`inmemory://model/${this.id}`));
		this.registry =
			options.register === false
				? undefined
				: (options.registry ?? defaultModelRegistry);
		this.registry?.add(this);
	}

	getValue(options: ValueOptions = {}): string {
		this.assertLive();
		let value = this.buffer.getValue();
		if (options.eol !== undefined) {
			this.assertEOL(options.eol);
			value = value.replace(/\r\n|\r|\n/g, options.eol);
		}
		return (options.preserveBOM ? this.bom : "") + value;
	}
	getValueLength(options: ValueOptions = {}): number {
		this.assertLive();
		if (!options.eol)
			return (
				this.buffer.getLength() +
				(options.preserveBOM ? this.bom.length : 0)
			);
		this.assertEOL(options.eol);
		return (
			this.buffer.getNormalizedLength() +
			(options.eol.length - 1) * (this.getLineCount() - 1) +
			(options.preserveBOM ? this.bom.length : 0)
		);
	}
	getValueInRange(range: Range, eol?: EndOfLine): string {
		this.assertLive();
		const { from, to } = this.buffer.getOffsets(range);
		const value = this.buffer.slice(from, to);
		if (!eol) return value;
		this.assertEOL(eol);
		return value.replace(/\r\n|\r|\n/g, eol);
	}
	getVerId(): number {
		return this.getVersionId();
	}
	getVersionId(): number {
		this.assertLive();
		return this.version;
	}
	getAlternativeVersionId(): number {
		this.assertLive();
		return this.alternativeVersion;
	}
	getEOL(): EndOfLine {
		this.assertLive();
		return this.eol;
	}
	getBOM(): string {
		this.assertLive();
		return this.bom;
	}
	getLineCount(): number {
		this.assertLive();
		return this.buffer.getLineCount();
	}
	getLineContent(line: number): string {
		this.assertLive();
		return this.buffer.getLineContent(line);
	}
	getLinesContent(): readonly string[] {
		return Array.from({ length: this.getLineCount() }, (_, index) =>
			this.getLineContent(index + 1),
		);
	}
	getLineLength(line: number): number {
		return this.getLineMaxColumn(line) - 1;
	}
	getLineMinColumn(line: number): number {
		this.getLineMaxColumn(line);
		return 1;
	}
	getLineMaxColumn(line: number): number {
		this.assertLive();
		return this.buffer.getLineMaxColumn(line);
	}
	getLineFirstNonWhitespaceColumn(line: number): number {
		const content = this.getLineContent(line);
		const index = content.search(/\S/u);
		return index < 0 ? 0 : index + 1;
	}
	getLineLastNonWhitespaceColumn(line: number): number {
		const content = this.getLineContent(line);
		return content.trim() ? content.trimEnd().length + 1 : 0;
	}
	getFullModelRange(): Range {
		this.assertLive();
		return this.buffer.getFullRange();
	}
	getOffsetAt(position: Position): number {
		this.assertLive();
		return this.buffer.getOffsetAt(position);
	}
	getPositionAt(offset: number): Position {
		this.assertLive();
		return this.buffer.getPositionAt(offset);
	}
	getInputOffsetAt(position: Position): number {
		return this.buffer.getNormalizedOffset(this.getOffsetAt(position));
	}
	getPositionAtInputOffset(offset: number): Position {
		this.assertLive();
		if (!Number.isFinite(offset))
			throw new RangeError("Offset must be finite.");
		return this.buffer.getPositionAt(this.buffer.getRawOffset(offset));
	}
	validatePosition(position: Position): Position {
		this.assertLive();
		return this.buffer.validatePosition(position);
	}
	validateRange(range: Range): Range {
		const start = this.validatePosition({
			line: range.startLine,
			column: range.startColumn,
		});
		let end = this.validatePosition({
			line: range.endLine,
			column: range.endColumn,
		});
		if (
			end.line < start.line ||
			(end.line === start.line && end.column < start.column)
		)
			end = start;
		return {
			startLine: start.line,
			startColumn: start.column,
			endLine: end.line,
			endColumn: end.column,
		};
	}
	isValidRange(range: Range): boolean {
		this.assertLive();
		try {
			this.buffer.getOffsets(range);
			return true;
		} catch {
			return false;
		}
	}
	getWordAtPosition(position: Position): ModelWord | null {
		const valid = this.validatePosition(position);
		for (const match of this.getLineContent(valid.line).matchAll(
			/[\p{ID_Continue}$]+/gu,
		))
			if (
				match.index <= valid.column - 1 &&
				valid.column - 1 <= match.index + match[0].length
			)
				return {
					word: match[0],
					startColumn: match.index + 1,
					endColumn: match.index + match[0].length + 1,
				};
		return null;
	}
	getWordUntilPosition(position: Position): ModelWord {
		const valid = this.validatePosition(position);
		const word = this.getWordAtPosition(valid);
		return word
			? {
					word: word.word.slice(0, valid.column - word.startColumn),
					startColumn: word.startColumn,
					endColumn: valid.column,
				}
			: { word: "", startColumn: valid.column, endColumn: valid.column };
	}
	findMatches(
		query: string,
		options: ModelSearchOptions = {},
	): { matches: readonly SearchMatch[]; truncated: boolean } {
		this.assertLive();
		if (typeof query !== "string")
			throw new TypeError("Search text must be a string.");
		const limit = options.limit ?? 10000;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
			throw new RangeError("Search limit must be between 1 and 10000.");
		const scope = options.range
			? this.buffer.getOffsets(options.range)
			: undefined;
		return findLiteralMatches(
			this.getValue({ eol: "\n" }),
			query.replace(/\r\n?/g, "\n"),
			{
				...(options.matchCase !== undefined
					? { matchCase: options.matchCase }
					: {}),
				...(options.wholeWord !== undefined
					? { wholeWord: options.wholeWord }
					: {}),
				...(scope
					? {
							scope: {
								from: this.buffer.getNormalizedOffset(
									scope.from,
								),
								to: this.buffer.getNormalizedOffset(scope.to),
							},
						}
					: {}),
			},
			limit,
		);
	}
	getGraphemeRangeAtPosition(position: Position): Range {
		const valid = this.validatePosition(position);
		const content = this.getLineContent(valid.line);
		for (const part of new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		}).segment(content))
			if (
				part.index <= valid.column - 1 &&
				part.index + part.segment.length > valid.column - 1
			)
				return {
					startLine: valid.line,
					startColumn: part.index + 1,
					endLine: valid.line,
					endColumn: part.index + part.segment.length + 1,
				};
		return {
			startLine: valid.line,
			startColumn: valid.column,
			endLine: valid.line,
			endColumn: valid.column,
		};
	}
	modifyPosition(position: Position, offset: number): Position {
		if (!Number.isFinite(offset))
			throw new RangeError("Offset must be finite.");
		return this.getPositionAt(
			this.getOffsetAt(position) + Math.trunc(offset),
		);
	}
	getOptions(): ModelOptions {
		this.assertLive();
		return Object.freeze({ ...this.options });
	}
	getLanguageId(): string {
		this.assertLive();
		return this.languageId;
	}
	getStorageStats(): ReturnType<TextBuffer["getStorageStats"]> {
		this.assertLive();
		return this.buffer.getStorageStats();
	}
	getHistoryStats(): ReturnType<History["getStats"]> {
		this.assertLive();
		return this.history.getStats();
	}

	updateOptions(options: Partial<ModelOptions>): void {
		this.assertWritable();
		const next = {
			...this.options,
			...options,
			...resolveIndentation(options, this.options),
		};
		if (
			Object.keys(next).every(
				(key) =>
					next[key as keyof ModelOptions] ===
					this.options[key as keyof ModelOptions],
			)
		)
			return;
		this.history.setLimits(next.historyLimit, next.historyByteLimit);
		this.history.pushStop();
		this.options = next;
		this.notify(() => this.optionsChanged.emit(this.getOptions()));
	}
	setLanguageId(languageId: string): void {
		this.assertWritable();
		if (typeof languageId !== "string" || !languageId.trim())
			throw new Error("Language ID must not be empty.");
		if (languageId === this.languageId) return;
		const oldLanguageId = this.languageId;
		this.languageId = languageId;
		this.history.pushStop();
		this.notify(() =>
			this.languageChanged.emit(
				Object.freeze({ oldLanguageId, languageId }),
			),
		);
	}

	setValue(text: string): void {
		this.assertWritable();
		if (typeof text !== "string")
			throw new TypeError("Document text must be a string.");
		const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
		const value = text.slice(bom.length);
		const changes = [
			{ offset: 0, length: this.buffer.getLength(), text: value },
		];
		const before = this.buffer;
		this.history.clear();
		this.ranges.invalidate();
		this.bom = bom;
		const oldEOL = this.eol;
		this.eol =
			(value.match(/\r\n|\r|\n/)?.[0] as EndOfLine | undefined) ??
			this.eol;
		this.buffer = new TextBuffer(value);
		this.alternativeVersion = ++this.nextAlternativeVersion;
		this.publish(
			before,
			changes,
			false,
			false,
			true,
			undefined,
			oldEOL !== this.eol,
			false,
		);
	}

	edit(
		edits: readonly TextEdit[],
		options: EditHistoryOptions = {},
	): readonly ContentChange[] {
		this.assertWritable();
		return this.commit(this.prepare(edits), options);
	}
	pushEditOperations(
		before: HistoryViewState | undefined,
		edits: readonly TextEdit[],
		computeAfter: (
			inverse: readonly ContentChange[],
			next: TextBuffer,
		) => HistoryViewState | undefined,
	): readonly ContentChange[] {
		this.assertWritable();
		return this.commit(
			this.prepare(edits),
			{ ...(before ? { before } : {}) },
			this.eol,
			computeAfter,
		);
	}
	private prepare(edits: readonly TextEdit[]): readonly ContentChange[] {
		const changes = edits
			.map((edit) => {
				if (typeof edit.text !== "string")
					throw new TypeError("Edit text must be a string.");
				const { from, to } = this.buffer.getOffsets(edit.range);
				return { offset: from, length: to - from, text: edit.text };
			})
			.sort((a, b) => a.offset - b.offset || a.length - b.length);
		for (let index = 1; index < changes.length; index++) {
			const previous = changes[index - 1];
			const current = changes[index];
			if (
				previous &&
				current &&
				(current.offset < previous.offset + previous.length ||
					(current.offset === previous.offset &&
						(!previous.length || !current.length)))
			)
				throw new RangeError("Edits overlap.");
		}
		return changes
			.filter(
				(change) =>
					this.buffer.slice(
						change.offset,
						change.offset + change.length,
					) !== change.text,
			)
			.map((change) => ({ ...change, text: copyText(change.text) }));
	}
	private commit(
		changes: readonly ContentChange[],
		options: EditHistoryOptions,
		eol = this.eol,
		computeAfter?: (
			inverse: readonly ContentChange[],
			next: TextBuffer,
		) => HistoryViewState | undefined,
	): readonly ContentChange[] {
		if (!changes.length && eol === this.eol) return [];
		const before = this.buffer;
		const next = before.applyChanges(changes);
		let delta = 0;
		const inverse: ContentChange[] = [];
		for (const change of changes) {
			const value = {
				offset: change.offset + delta,
				length: change.text.length,
				text: before.slice(
					change.offset,
					change.offset + change.length,
				),
			};
			delta += change.text.length - change.length;
			const previous = inverse.at(-1);
			if (previous && previous.offset === value.offset)
				inverse[inverse.length - 1] = Object.freeze({
					offset: previous.offset,
					length: previous.length + value.length,
					text: previous.text + value.text,
				});
			else inverse.push(Object.freeze(value));
		}
		let historyOptions = options;
		if (computeAfter) {
			this.computing = true;
			try {
				const after = computeAfter(Object.freeze(inverse), next);
				historyOptions = { ...options, ...(after ? { after } : {}) };
			} finally {
				this.computing = false;
			}
		}
		const oldEOL = this.eol;
		const alternative = ++this.nextAlternativeVersion;
		const retained = this.history.record(
			{ forward: changes, inverse },
			historyOptions,
			this.alternativeVersion,
			alternative,
			oldEOL,
			eol,
		);
		this.ranges.map(changes);
		this.buffer = next;
		this.eol = eol;
		this.alternativeVersion = alternative;
		this.publish(
			before,
			changes,
			false,
			false,
			false,
			undefined,
			oldEOL !== eol,
			!retained &&
				this.options.historyLimit > 0 &&
				this.options.historyByteLimit > 0,
		);
		return Object.freeze(inverse);
	}
	setEOL(eol: EndOfLine): void {
		this.assertWritable();
		this.assertEOL(eol);
		const changes: ContentChange[] = [];
		for (let line = 1; line < this.buffer.getLineCount(); line++) {
			const from = this.buffer.getLineEnd(line);
			const to = this.buffer.getLineStart(line + 1);
			if (this.buffer.slice(from, to) !== eol)
				changes.push({ offset: from, length: to - from, text: eol });
		}
		this.history.pushStop();
		this.commit(changes, {}, eol);
		this.history.pushStop();
	}
	pushStackElement(): void {
		this.assertWritable();
		this.history.pushStop();
	}
	popStackElement(): boolean {
		this.assertWritable();
		return this.history.popStop();
	}
	canUndo(): boolean {
		this.assertLive();
		return this.history.undoable();
	}
	canRedo(): boolean {
		this.assertLive();
		return this.history.redoable();
	}
	undo(): void {
		this.replay(false);
	}
	redo(): void {
		this.replay(true);
	}
	private replay(redo: boolean): void {
		this.assertWritable();
		const entry = redo ? this.history.peekRedo() : this.history.peekUndo();
		if (!entry) return;
		const before = this.buffer;
		const batches = redo
			? entry.batches.map((batch) => batch.forward)
			: [...entry.batches].reverse().map((batch) => batch.inverse);
		const changes = composeChanges(before.getLength(), batches);
		let next = before;
		const mappingBatches: (readonly InputMappingSegment[])[] = [];
		for (const batch of batches) {
			const after = next.applyChanges(batch);
			mappingBatches.push(inputMappings(next, after, batch));
			next = after;
		}
		const oldEOL = this.eol;
		this.eol = (redo ? entry.afterEOL : entry.beforeEOL) as EndOfLine;
		for (const batch of batches) this.ranges.map(batch);
		this.buffer = next;
		this.alternativeVersion = redo
			? entry.afterVersion
			: entry.beforeVersion;
		if (redo) this.history.redo();
		else this.history.undo();
		this.publish(
			before,
			changes,
			!redo,
			redo,
			false,
			redo ? entry.afterState : entry.beforeState,
			oldEOL !== this.eol,
			false,
			mappingBatches,
		);
	}

	trackRange(range: Range, options: TrackedRangeOptions = {}): TrackedRange {
		this.assertLive();
		const id = this.ranges.add(this.buffer, range, options);
		let disposed = false;
		return Object.freeze({
			id,
			getRange: () =>
				disposed || this.disposed
					? null
					: this.ranges.get(this.buffer, id),
			setRange: (next: Range) => {
				this.assertLive();
				if (disposed) throw new Error("Tracked range disposed.");
				this.ranges.set(this.buffer, id, next);
			},
			dispose: () => {
				disposed = true;
				this.ranges.remove(id);
			},
		});
	}
	getTrackedRange(id: string): Range | null {
		this.assertLive();
		return this.ranges.get(this.buffer, id);
	}
	createSnapshot(preserveBOM = false): {
		read(): string | null;
		dispose(): void;
	} {
		this.assertLive();
		const snapshot = this.buffer.createSnapshot();
		let bom = preserveBOM ? this.bom : "";
		return {
			read: () => {
				if (bom) {
					const value = bom;
					bom = "";
					return value;
				}
				return snapshot.read();
			},
			dispose: () => {
				bom = "";
				snapshot.dispose();
			},
		};
	}
	onDidChangeContent(
		listener: (event: ModelChangeEvent) => void,
	): Disposable {
		this.assertLive();
		return this.content.on(listener);
	}
	onDidChangeOptions(listener: (options: ModelOptions) => void): Disposable {
		this.assertLive();
		return this.optionsChanged.on(listener);
	}
	onDidChangeLanguage(
		listener: (event: {
			readonly oldLanguageId: string;
			readonly languageId: string;
		}) => void,
	): Disposable {
		this.assertLive();
		return this.languageChanged.on(listener);
	}
	onWillDispose(listener: () => void): Disposable {
		this.assertLive();
		return this.willDispose.on(listener);
	}
	onDidChangeAttached(
		listener: (event: { readonly viewCount: number }) => void,
	): Disposable {
		this.assertLive();
		return this.attached.on(listener);
	}
	attachView(owner: string): Disposable {
		this.assertLive();
		if (this.owners.has(owner)) throw new Error("View already attached.");
		this.owners.add(owner);
		this.notify(() => this.attached.emit({ viewCount: this.owners.size }));
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.owners.delete(owner) && !this.disposed)
					this.notify(() =>
						this.attached.emit({ viewCount: this.owners.size }),
					);
			},
		};
	}
	isAttachedToEditor(): boolean {
		return !this.disposed && this.owners.size > 0;
	}
	isDisposed(): boolean {
		return this.disposed;
	}
	/** @internal Validate registry-wide disposal before closing any document. */
	assertCanDispose(): void {
		if (!this.disposed) this.assertWritable();
	}
	dispose(): void {
		if (this.disposed || this.disposing) return;
		this.assertWritable();
		this.disposing = true;
		this.willDispose.emit();
		this.registry?.remove(this);
		this.disposed = true;
		this.content.dispose();
		this.optionsChanged.dispose();
		this.languageChanged.dispose();
		this.willDispose.dispose();
		this.attached.dispose();
		this.owners.clear();
		this.history.clear();
		this.ranges.clear();
		this.buffer = new TextBuffer();
	}
	private publish(
		before: TextBuffer,
		changes: readonly ContentChange[],
		undoing: boolean,
		redoing: boolean,
		flush: boolean,
		historyState: HistoryViewState | undefined,
		eolChanged: boolean,
		historyTruncated: boolean,
		mappingBatches?: readonly (readonly InputMappingSegment[])[],
	): void {
		this.version++;
		const immutable = (values: readonly ContentChange[]) =>
			Object.freeze(values.map((change) => Object.freeze({ ...change })));
		const event: ModelChangeEvent = Object.freeze({
			verId: this.version,
			alternativeVersionId: this.alternativeVersion,
			changes: immutable(changes),
			inputChanges: immutable(inputChanges(before, changes)),
			inputMappings: Object.freeze(
				(mappingBatches?.length === 1
					? (mappingBatches[0] ?? [])
					: inputMappings(before, this.buffer, changes)
				).map((mapping) => Object.freeze(mapping)),
			),
			...(mappingBatches
				? {
						inputMappingBatches: Object.freeze(
							mappingBatches.map((batch) =>
								Object.freeze(
									batch.map((mapping) =>
										Object.freeze(mapping),
									),
								),
							),
						),
					}
				: {}),
			undoing,
			redoing,
			flush,
			eol: this.eol,
			eolChanged,
			historyTruncated,
			...(historyState ? { historyState } : {}),
		});
		this.notify(() => this.content.emit(event));
	}
	private notify(run: () => void): void {
		const previous = this.notifying;
		this.notifying = true;
		try {
			run();
		} finally {
			this.notifying = previous;
		}
	}
	private assertLive(): void {
		if (this.disposed) throw new Error("Text model disposed.");
	}
	private assertWritable(): void {
		this.assertLive();
		if (this.notifying || this.computing || this.disposing)
			throw new Error(
				"Schedule model changes after the current model callback.",
			);
	}
	private assertEOL(eol: string): asserts eol is EndOfLine {
		if (eol !== "\n" && eol !== "\r\n" && eol !== "\r")
			throw new Error("Unsupported line ending.");
	}
}
