import { TextDocument, type TextEdit } from "./document";
import { type Selection, validateSelection } from "./selection";

export interface Transaction {
	readonly edit: TextEdit;
	readonly selectionAfter?: Selection;
	readonly group?: string;
}

interface HistoryEntry {
	edit: TextEdit;
	readonly selection: Selection;
}

export class EditorSession {
	private lastGroup:
		| { name: string; time: number; edit: TextEdit }
		| undefined;
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

	breakUndoGroup(): void {
		this.lastGroup = undefined;
	}

	setSelection(selection: Selection): void {
		validateSelection(this.document.text, selection);
		if (
			selection.anchor !== this.currentSelection.anchor ||
			selection.head !== this.currentSelection.head
		)
			this.lastGroup = undefined;
		this.currentSelection = { ...selection };
	}

	reset(text: string): void {
		this.document.apply({ from: 0, to: this.document.text.length, text });
		this.currentSelection = { anchor: 0, head: 0 };
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.lastGroup = undefined;
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
		const previous = this.undoStack.at(-1);
		const group = this.lastGroup;
		let grouped = false;
		if (
			previous &&
			group &&
			transaction.group === group.name &&
			Date.now() - group.time < 750 &&
			this.currentSelection.anchor === this.currentSelection.head
		) {
			if (
				edit.from === edit.to &&
				group.edit.from === group.edit.to &&
				edit.from === group.edit.from + group.edit.text.length
			) {
				previous.edit = {
					from: previous.edit.from,
					to: inverse.to,
					text: "",
				};
				group.edit = {
					...group.edit,
					text: group.edit.text + edit.text,
				};
				grouped = true;
			} else if (
				!edit.text &&
				!group.edit.text &&
				edit.to === group.edit.from
			) {
				previous.edit = {
					from: inverse.from,
					to: inverse.to,
					text: inverse.text + previous.edit.text,
				};
				group.edit = { from: edit.from, to: group.edit.to, text: "" };
				grouped = true;
			} else if (
				!edit.text &&
				!group.edit.text &&
				edit.from === group.edit.from
			) {
				previous.edit = {
					...previous.edit,
					text: previous.edit.text + inverse.text,
				};
				grouped = true;
			}
		}
		if (!grouped)
			this.undoStack.push({ edit: inverse, selection: this.selection });
		this.lastGroup = transaction.group
			? {
					name: transaction.group,
					time: Date.now(),
					edit: grouped && group ? group.edit : { ...edit },
				}
			: undefined;
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
		this.lastGroup = undefined;
		const entry = source.pop();
		if (!entry) return false;
		const inverse = this.document.apply(entry.edit);
		target.push({ edit: inverse, selection: this.selection });
		this.currentSelection = { ...entry.selection };
		return true;
	}
}
