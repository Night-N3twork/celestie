import type {
	ContentChange,
	Disposable,
	ModelChangeEvent,
	Position,
	Range,
	TextEdit,
} from "../api/types";
import { History } from "./history";
import { TextBuffer } from "./text-buffer";

export class TextModel implements Disposable {
	private buffer: TextBuffer;
	private readonly history = new History();
	private readonly listeners = new Set<(event: ModelChangeEvent) => void>();
	private version = 1;
	private disposed = false;
	private notifying = false;

	constructor(
		text = "",
		private readonly reportError: (error: unknown) => void = console.error,
	) {
		this.buffer = new TextBuffer(text);
	}

	getValue(): string {
		this.assertLive();
		return this.buffer.getValue();
	}

	getVerId(): number {
		this.assertLive();
		return this.version;
	}

	getLineCount(): number {
		this.assertLive();
		return this.buffer.getLineCount();
	}

	getLineContent(lineNumber: number): string {
		this.assertLive();
		return this.buffer.getLineContent(lineNumber);
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

	setValue(text: string): void {
		this.assertWritable();
		const next = new TextBuffer(text);
		const change = {
			offset: 0,
			length: this.buffer.getLength(),
			text,
		};
		this.history.clear();
		this.publish(next, [change], false, false, true);
	}

	edit(edits: readonly TextEdit[]): void {
		this.assertWritable();
		const changes = edits
			.map((edit) => {
				if (typeof edit.text !== "string")
					throw new TypeError("Edit text must be a string.");
				const { from, to } = this.buffer.getOffsets(edit.range);
				return {
					offset: from,
					length: to - from,
					text: edit.text,
				};
			})
			.sort(
				(a, b) =>
					a.offset - b.offset ||
					a.length - b.length,
			);
		for (let index = 1; index < changes.length; index++) {
			const previous = changes[index - 1];
			const current = changes[index];
			if (
				previous &&
				current &&
				(current.offset <
					previous.offset + previous.length ||
					(current.offset ===
						previous.offset + previous.length &&
						(previous.length === 0 ||
							current.length === 0)))
			) {
				throw new RangeError(
					"Edits overlap.",
				);
			}
		}
		const before = this.buffer.getValue();
		const effective = changes.filter(
			(change) =>
				before.slice(
					change.offset,
					change.offset + change.length,
				) !== change.text,
		);
		if (effective.length === 0) return;
		const parts: string[] = [];
		let cursor = 0;
		for (const change of effective) {
			parts.push(before.slice(cursor, change.offset), change.text);
			cursor = change.offset + change.length;
		}
		parts.push(before.slice(cursor));
		const after = parts.join("");
		const next = new TextBuffer(after);
		this.history.record(before, after);
		this.publish(next, effective, false, false, false);
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
		this.assertWritable();
		const text = this.history.peekUndo();
		if (text === undefined) return;
		const next = new TextBuffer(text);
		const change = {
			offset: 0,
			length: this.buffer.getLength(),
			text,
		};
		this.history.undo();
		this.publish(next, [change], true, false, false);
	}

	redo(): void {
		this.assertWritable();
		const text = this.history.peekRedo();
		if (text === undefined) return;
		const next = new TextBuffer(text);
		const change = {
			offset: 0,
			length: this.buffer.getLength(),
			text,
		};
		this.history.redo();
		this.publish(next, [change], false, true, false);
	}

	createSnapshot(): { read(): string | null } {
		const text = this.getValue();
		let consumed = false;
		return {
			read: () => {
				if (consumed) return null;
				consumed = true;
				return text;
			},
		};
	}

	onDidChangeContent(
		listener: (event: ModelChangeEvent) => void,
	): Disposable {
		this.assertLive();
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose(): void {
		if (this.disposed) return;
		this.assertWritable();
		this.disposed = true;
		this.listeners.clear();
		this.history.clear();
		this.buffer = new TextBuffer();
	}

	private publish(
		buffer: TextBuffer,
		changes: readonly ContentChange[],
		undoing: boolean,
		redoing: boolean,
		flush: boolean,
	): void {
		this.buffer = buffer;
		this.version++;
		const event: ModelChangeEvent = Object.freeze({
			verId: this.version,
			changes: Object.freeze(
				changes.map((change) => Object.freeze({ ...change })),
			),
			undoing,
			redoing,
			flush,
		});
		this.notifying = true;
		try {
			for (const listener of [...this.listeners]) {
				try {
					listener(event);
				} catch (error) {
					try {
						this.reportError(error);
					} catch {
					}
				}
			}
		} finally {
			this.notifying = false;
		}
	}

	private assertLive(): void {
		if (this.disposed) throw new Error("Text model disposed.");
	}

	private assertWritable(): void {
		this.assertLive();
		if (this.notifying)
			throw new Error(
				"Schedule model changes after the current change event.",
			);
	}
}
