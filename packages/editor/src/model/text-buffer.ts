import type { Position, Range } from "../api/types";

export class TextBuffer {
	private readonly starts: number[] = [0];
	private readonly ends: number[] = [];

	constructor(private readonly text: string = "") {
		for (let offset = 0; offset < text.length; offset++) {
			const unit = text.charCodeAt(offset);
			if (unit !== 10 && unit !== 13) continue;
			this.ends.push(offset);
			if (unit === 13 && text.charCodeAt(offset + 1) === 10) offset++;
			this.starts.push(offset + 1);
		}
		this.ends.push(text.length);
	}

	getValue(): string {
		return this.text;
	}

	getLength(): number {
		return this.text.length;
	}

	getLineCount(): number {
		return this.starts.length;
	}

	getLineContent(lineNumber: number): string {
		this.assertLine(lineNumber);
		return this.text.slice(
			this.starts[lineNumber - 1],
			this.ends[lineNumber - 1],
		);
	}

	getLineMaxColumn(lineNumber: number): number {
		return this.getLineContent(lineNumber).length + 1;
	}

	getFullRange(): Range {
		const lastLine = this.getLineCount();
		return {
			startLine: 1,
			startColumn: 1,
			endLine: lastLine,
			endColumn: this.getLineMaxColumn(lastLine),
		};
	}

	validatePosition(position: Position): Position {
		if (
			!Number.isFinite(position.line) ||
			!Number.isFinite(position.column)
		) {
			throw new RangeError("Position must contain finite numbers.");
		}
		const lineNumber = Math.max(
			1,
			Math.min(this.getLineCount(), Math.trunc(position.line)),
		);
		const column = Math.max(
			1,
			Math.min(
				this.getLineMaxColumn(lineNumber),
				Math.trunc(position.column),
			),
		);
		return { line: lineNumber, column };
	}

	getOffsetAt(position: Position): number {
		const valid = this.validatePosition(position);
		return (this.starts[valid.line - 1] ?? 0) + valid.column - 1;
	}

	getPositionAt(offset: number): Position {
		if (!Number.isFinite(offset))
			throw new RangeError("Offset must be finite.");
		const valid = Math.max(
			0,
			Math.min(this.text.length, Math.trunc(offset)),
		);
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if ((this.starts[middle] ?? 0) <= valid) low = middle;
			else high = middle - 1;
		}
		return {
			line: low + 1,
			column:
				Math.min(valid, this.ends[low] ?? valid) -
				(this.starts[low] ?? 0) +
				1,
		};
	}

	getOffsets(range: Range): { from: number; to: number } {
		const start = {
			line: range.startLine,
			column: range.startColumn,
		};
		const end = {
			line: range.endLine,
			column: range.endColumn,
		};
		for (const position of [start, end]) {
			const valid = this.validatePosition(position);
			if (
				valid.line !== position.line ||
				valid.column !== position.column
			) {
				throw new RangeError("Edit range is outside the document.");
			}
		}
		const from = this.getOffsetAt(start);
		const to = this.getOffsetAt(end);
		if (from > to)
			throw new RangeError("Range start must precede its end.");
		return { from, to };
	}

	private assertLine(lineNumber: number): void {
		if (
			!Number.isInteger(lineNumber) ||
			lineNumber < 1 ||
			lineNumber > this.starts.length
		) {
			throw new RangeError("Line number is outside the document.");
		}
	}
}
