import { TextDocument, type TextEdit } from "./document";
import { type Selection, validateSelection } from "./selection";

export interface Transaction {
	readonly edit: TextEdit;
	readonly selectionAfter?: Selection;
}

interface HistoryEntry {
	readonly edit: TextEdit;
	readonly selection: Selection;
}

export class EditorSession {
	private readonly document: TextDocument;
	private currentSelection: Selection = { anchor: 0, head: 0 };
	private readonly undoStack: HistoryEntry[] = [];
	private readonly redoStack: HistoryEntry[] = [];

	constructor(text = "") {
		this.document = new TextDocument(text);
	}

	get snapshot() {
		return this.document.snapshot();
	}

	get selection(): Selection {
		return { ...this.currentSelection };
	}

	setSelection(selection: Selection): void {
		validateSelection(this.document.text, selection);
		this.currentSelection = { ...selection };
	}

	apply(transaction: Transaction): void {
		const { edit } = transaction;
		const cursor = edit.from + edit.text.length;
		const selection = transaction.selectionAfter ?? {
			anchor: cursor,
			head: cursor,
		};
		const next = new TextDocument(this.document.text);
		next.apply(edit);
		validateSelection(next.text, selection);
		const inverse = this.document.apply(edit);
		this.undoStack.push({ edit: inverse, selection: this.selection });
		this.currentSelection = { ...selection };
		this.redoStack.length = 0;
	}

	undo(): boolean {
		return this.restore(this.undoStack, this.redoStack);
	}

	redo(): boolean {
		return this.restore(this.redoStack, this.undoStack);
	}

	private restore(source: HistoryEntry[], target: HistoryEntry[]): boolean {
		const entry = source.pop();
		if (!entry) return false;
		const inverse = this.document.apply(entry.edit);
		target.push({ edit: inverse, selection: this.selection });
		this.currentSelection = { ...entry.selection };
		return true;
	}
}
