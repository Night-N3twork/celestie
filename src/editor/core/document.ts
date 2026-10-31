export interface Position {
	readonly line: number;
	readonly column: number;
}

export interface TextEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

export interface DocumentSnapshot {
	readonly text: string;
	readonly version: number;
}

export function handleOffset(text: string, offset: number): void {
	if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
		throw new RangeError(`Invalid document offset: ${offset}`);
	}
}

export class TextDocument {
	private content: string;
	private revision = 0;

	constructor(text = "") {
		this.content = text;
	}

	get text(): string {
		return this.content;
	}

	get version(): number {
		return this.revision;
	}

	snapshot(): DocumentSnapshot {
		return { text: this.content, version: this.revision };
	}

	positionAt(offset: number): Position {
		handleOffset(this.content, offset);
		const prefix = this.content.slice(0, offset);
		return {
			line: prefix.split("\n").length - 1,
			column: offset - prefix.lastIndexOf("\n") - 1,
		};
	}

	apply(edit: TextEdit): TextEdit {
		handleOffset(this.content, edit.from);
		handleOffset(this.content, edit.to);
		if (edit.from > edit.to) throw new RangeError("Reversed edit range");
		const inverse = {
			from: edit.from,
			to: edit.from + edit.text.length,
			text: this.content.slice(edit.from, edit.to),
		};
		this.content =
			this.content.slice(0, edit.from) +
			edit.text +
			this.content.slice(edit.to);
		this.revision += 1;
		return inverse;
	}
}
