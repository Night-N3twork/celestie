import type { ContentChange, Position, Range } from "../api/types";
import * as tree from "./piece-tree";

export class PieceBuffer {
	private readonly root: tree.Root;
	private value: string | undefined;
	constructor(text = "", root?: tree.Node) {
		this.root = root ?? tree.build(text);
	}

	getValue(): string {
		this.value ??= this.slice(0, this.getLength());
		return this.value;
	}
	getLength(): number {
		return this.root?.length ?? 0;
	}
	getLineCount(): number {
		return (this.root?.breaks ?? 0) + 1;
	}
	getNormalizedLength(): number {
		return this.getLength() - (this.root?.crlf ?? 0);
	}
	getStorageStats(): { length: number; pieces: number; height: number } {
		return {
			length: this.getLength(),
			pieces: this.root?.pieces ?? 0,
			height: this.root?.height ?? 0,
		};
	}
	charAt(offset: number): string {
		return tree.characterAt(this.root, offset);
	}
	slice(from: number, to: number): string {
		return tree.slice(
			this.root,
			Math.max(0, from),
			Math.min(this.getLength(), to),
		);
	}
	createSnapshot(): { read(): string | null; dispose(): void } {
		return tree.snapshot(this.root);
	}

	applyChanges(changes: readonly ContentChange[]): PieceBuffer {
		let root = this.root;
		for (let index = changes.length - 1; index >= 0; index--) {
			const change = changes[index];
			if (!change) continue;
			const [before, tail] = tree.split(root, change.offset);
			const [, after] = tree.split(tail, change.length);
			root = tree.join(tree.join(before, tree.build(change.text)), after);
		}
		return new PieceBuffer("", root);
	}

	getLineStart(line: number): number {
		this.assertLine(line);
		return line === 1 ? 0 : tree.breakEnd(this.root, line - 1);
	}
	getLineEnd(line: number): number {
		this.assertLine(line);
		if (line === this.getLineCount()) return this.getLength();
		const next = this.getLineStart(line + 1);
		return (
			next -
			(this.charAt(next - 1) === "\n" && this.charAt(next - 2) === "\r"
				? 2
				: 1)
		);
	}
	getLineContent(line: number): string {
		return this.slice(this.getLineStart(line), this.getLineEnd(line));
	}
	getLineMaxColumn(line: number): number {
		return this.getLineEnd(line) - this.getLineStart(line) + 1;
	}
	getFullRange(): Range {
		const line = this.getLineCount();
		return {
			startLine: 1,
			startColumn: 1,
			endLine: line,
			endColumn: this.getLineMaxColumn(line),
		};
	}

	validatePosition(position: Position): Position {
		if (
			!Number.isFinite(position.line) ||
			!Number.isFinite(position.column)
		)
			throw new RangeError("Position must contain finite numbers.");
		const line = Math.max(
			1,
			Math.min(this.getLineCount(), Math.trunc(position.line)),
		);
		return {
			line,
			column: Math.max(
				1,
				Math.min(
					this.getLineMaxColumn(line),
					Math.trunc(position.column),
				),
			),
		};
	}
	getOffsetAt(position: Position): number {
		const valid = this.validatePosition(position);
		return this.getLineStart(valid.line) + valid.column - 1;
	}
	getPositionAt(offset: number): Position {
		if (!Number.isFinite(offset))
			throw new RangeError("Offset must be finite.");
		const valid = Math.max(
			0,
			Math.min(this.getLength(), Math.trunc(offset)),
		);
		const summary = tree.prefix(this.root, valid);
		const partialCRLF =
			this.charAt(valid - 1) === "\r" && this.charAt(valid) === "\n"
				? 1
				: 0;
		const line = summary.breaks - partialCRLF + 1;
		return {
			line,
			column:
				Math.min(valid, this.getLineEnd(line)) -
				this.getLineStart(line) +
				1,
		};
	}
	getNormalizedOffset(offset: number): number {
		const valid = Math.max(0, Math.min(this.getLength(), offset));
		if (!this.root?.crlf) return valid;
		return (
			valid -
			tree.prefix(this.root, valid).crlf -
			(this.charAt(valid - 1) === "\r" && this.charAt(valid) === "\n"
				? 1
				: 0)
		);
	}
	getRawOffset(normalizedOffset: number): number {
		const target = Math.max(
			0,
			Math.min(this.getNormalizedLength(), Math.trunc(normalizedOffset)),
		);
		if (!this.root?.crlf) return target;
		let low = 0;
		let high = this.getLength();
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.getNormalizedOffset(middle) < target) low = middle + 1;
			else high = middle;
		}
		return low;
	}
	getOffsets(range: Range): { from: number; to: number } {
		const start = { line: range.startLine, column: range.startColumn };
		const end = { line: range.endLine, column: range.endColumn };
		for (const position of [start, end]) {
			const valid = this.validatePosition(position);
			if (
				valid.line !== position.line ||
				valid.column !== position.column
			)
				throw new RangeError("Edit range is outside the document.");
		}
		const from = this.getOffsetAt(start);
		const to = this.getOffsetAt(end);
		if (from > to)
			throw new RangeError("Range start must precede its end.");
		return { from, to };
	}
	private assertLine(line: number): void {
		if (!Number.isInteger(line) || line < 1 || line > this.getLineCount())
			throw new RangeError("Line number is outside the document.");
	}
}
