import type { Disposable, TextSelection } from "../api/types";
import { findTextChange } from "../view/input";
import type { KeyboardShortcuts } from "./keyboard-shortcuts";
import { findLiteralMatches, type SearchMatch } from "./search";

export interface SearchEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

interface FindReplaceHost {
	onOpen(): void;
	getText(): string;
	getSelection(): TextSelection;
	selectMatch(match: SearchMatch): void;
	replace(edits: readonly SearchEdit[], expectedText: string): void;
	highlight(matches: readonly SearchMatch[], current: number): void;
	focusEditor(): void;
}

export class FindReplace implements Disposable {
	private readonly panel: HTMLDivElement;
	private readonly query: HTMLInputElement;
	private readonly replacement: HTMLInputElement;
	private readonly replacementRow: HTMLDivElement;
	private readonly status: HTMLSpanElement;
	private readonly previous: HTMLButtonElement;
	private readonly next: HTMLButtonElement;
	private readonly replaceOne: HTMLButtonElement;
	private readonly replaceAll: HTMLButtonElement;
	private readonly subscriptions: Disposable[] = [];
	private matches: readonly SearchMatch[] = [];
	private current = -1;
	private truncated = false;
	private disposed = false;
	private readonly matchCase: HTMLInputElement;
	private readonly wholeWord: HTMLInputElement;
	private readonly inSelection: HTMLInputElement;
	private scope: { from: number; to: number } | undefined;
	private previousText = "";

	constructor(
		container: HTMLElement,
		private readonly host: FindReplaceHost,
		shortcuts: KeyboardShortcuts,
	) {
		const document = container.ownerDocument;
		this.panel = document.createElement("div");
		this.panel.className = "editor-find-panel";
		this.panel.setAttribute("role", "search");
		this.panel.setAttribute("aria-label", "Find and replace");
		this.panel.hidden = true;
		this.query = document.createElement("input");
		this.query.type = "search";
		this.query.placeholder = "Find text";
		this.query.setAttribute("aria-label", "Find text");
		this.replacement = document.createElement("input");
		this.replacement.placeholder = "Replace with";
		this.replacement.setAttribute("aria-label", "Replacement text");
		for (const input of [this.query, this.replacement]) {
			input.spellcheck = false;
			input.autocomplete = "off";
		}
		this.status = document.createElement("span");
		this.status.className = "editor-find-status";
		this.status.setAttribute("role", "status");
		const button = (label: string, run: () => void): HTMLButtonElement => {
			const element = document.createElement("button");
			element.type = "button";
			element.textContent = label;
			element.addEventListener("click", run);
			this.subscriptions.push({
				dispose: () => element.removeEventListener("click", run),
			});
			return element;
		};
		this.previous = button("Previous", () => this.navigate(-1));
		this.next = button("Next", () => this.navigate(1));
		this.replaceOne = button("Replace", () => this.replaceCurrent());
		this.replaceAll = button("Replace All", () => this.replaceEveryMatch());
		const findRow = document.createElement("div");
		findRow.className = "editor-find-row";
		findRow.append(
			this.query,
			this.status,
			this.previous,
			this.next,
			button("Show replace", () => this.open(true)),
			button("Close", () => this.close()),
		);
		this.replacementRow = document.createElement("div");
		this.replacementRow.className = "editor-find-row";
		this.replacementRow.hidden = true;
		this.replacementRow.append(
			this.replacement,
			this.replaceOne,
			this.replaceAll,
		);
		const optionsRow = document.createElement("div");
		optionsRow.className = "editor-find-row editor-find-options";
		const option = (name: string, checked = false): HTMLInputElement => {
			const label = document.createElement("label");
			const input = document.createElement("input");
			input.type = "checkbox";
			input.checked = checked;
			label.append(input, name);
			optionsRow.append(label);
			input.addEventListener("change", this.queryChanged);
			this.subscriptions.push({
				dispose: () =>
					input.removeEventListener("change", this.queryChanged),
			});
			return input;
		};
		this.matchCase = option("Match case", true);
		this.wholeWord = option("Whole word");
		this.inSelection = option("In selection");
		this.panel.append(findRow, optionsRow, this.replacementRow);
		container.prepend(this.panel);
		this.query.addEventListener("input", this.queryChanged);

		this.subscriptions.push(
			shortcuts.register({
				id: "editor.find",
				key: "f",
				primary: true,
				run: () => this.open(),
			}),
			shortcuts.register({
				id: "editor.replace",
				key: "h",
				ctrl: true,
				run: () => this.open(true),
			}),
			shortcuts.register({
				id: "editor.replaceMac",
				key: "f",
				primary: true,
				alt: true,
				run: () => this.open(true),
			}),
			shortcuts.register({
				id: "editor.closeFind",
				key: "Escape",
				when: () => this.isOpen,
				run: () => this.close(),
			}),
			shortcuts.registerScope(this.panel, [
				{ id: "find.close", key: "Escape", run: () => this.close() },
				{
					id: "find.next",
					key: "Enter",
					when: () => document.activeElement === this.query,
					run: () => this.navigate(1),
				},
				{
					id: "find.previous",
					key: "Enter",
					shift: true,
					when: () => document.activeElement === this.query,
					run: () => this.navigate(-1),
				},
				{
					id: "find.replace",
					key: "Enter",
					when: () => document.activeElement === this.replacement,
					run: () => this.replaceCurrent(),
				},
				{
					id: "find.focus",
					key: "f",
					primary: true,
					run: () => this.open(),
				},
				{
					id: "find.showReplace",
					key: "h",
					ctrl: true,
					run: () => this.open(true),
				},
				{
					id: "find.showReplaceMac",
					key: "f",
					primary: true,
					alt: true,
					run: () => this.open(true),
				},
			]),
		);
	}

	get isOpen(): boolean {
		return !this.panel.hidden;
	}

	open(replace = false): void {
		if (this.disposed) return;
		this.host.onOpen();
		const selection = this.host.getSelection();
		if (!this.isOpen) {
			this.scope =
				selection.start !== selection.end
					? { from: selection.start, to: selection.end }
					: undefined;
			this.previousText = this.host.getText();
			this.inSelection.checked = false;
			this.inSelection.disabled = !this.scope;
		}
		const seed = this.host.getText().slice(selection.start, selection.end);
		if (!this.isOpen && seed && !seed.includes("\n"))
			this.query.value = seed;
		this.panel.hidden = false;
		if (replace) this.replacementRow.hidden = false;
		this.refresh(true);
		this.query.focus();
		this.query.select();
	}

	close(focus = true): void {
		this.panel.hidden = true;
		this.host.highlight([], -1);
		if (focus) this.host.focusEditor();
	}

	refresh(select = false, anchor = this.host.getSelection().start): void {
		if (this.disposed || !this.isOpen) return;
		const text = this.host.getText();
		const change = findTextChange(this.previousText, text);
		if (change && this.scope) {
			const delta = change.text.length - (change.to - change.from);
			const map = (offset: number, end: boolean): number =>
				offset < change.from
					? offset
					: offset > change.to
						? offset + delta
						: change.from + (end ? change.text.length : 0);
			this.scope = {
				from: map(this.scope.from, false),
				to: map(this.scope.to, true),
			};
		}
		this.previousText = text;
		const result = findLiteralMatches(text, this.query.value, {
			matchCase: this.matchCase.checked,
			wholeWord: this.wholeWord.checked,
			...(this.inSelection.checked && this.scope
				? { scope: this.scope }
				: {}),
		});
		this.matches = result.matches;
		this.truncated = result.truncated;
		const index = this.matches.findIndex((match) => match.from >= anchor);
		this.current = this.matches.length ? (index === -1 ? 0 : index) : -1;
		this.present(select);
	}

	private readonly queryChanged = (): void => this.refresh(true);

	private present(select: boolean, wrapped = false): void {
		const count = this.matches.length;
		this.status.textContent = !this.query.value
			? "Enter search text"
			: count
				? `${this.current + 1} of ${count}${this.truncated ? "+ (refine search for Replace All)" : ""}${wrapped ? " (wrapped)" : ""}`
				: "No results";
		this.previous.disabled =
			this.next.disabled =
			this.replaceOne.disabled =
				count === 0;
		this.replaceAll.disabled = count === 0 || this.truncated;
		this.host.highlight(this.matches, this.current);
		const match = this.matches[this.current];
		if (select && match) this.host.selectMatch(match);
	}

	private navigate(direction: number): void {
		this.refresh();
		if (!this.matches.length) return;
		const index = this.current + direction;
		this.current = (index + this.matches.length) % this.matches.length;
		this.present(true, index < 0 || index >= this.matches.length);
	}

	private replaceCurrent(): void {
		this.refresh();
		const match = this.matches[this.current];
		if (!match) return;
		const text = this.replacement.value;
		this.host.replace(
			[{ from: match.from, to: match.to, text }],
			this.host.getText(),
		);
		this.refresh(true, match.from + text.length);
		this.replacement.focus();
	}

	private replaceEveryMatch(): void {
		this.refresh();
		if (!this.matches.length || this.truncated) return;
		const first = this.matches[0];
		const text = this.replacement.value;
		this.host.replace(
			this.matches.map((match) => ({
				from: match.from,
				to: match.to,
				text,
			})),
			this.host.getText(),
		);
		this.refresh(false, (first?.from ?? 0) + text.length);
		this.replacement.focus();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.query.removeEventListener("input", this.queryChanged);
		for (const subscription of this.subscriptions.reverse())
			subscription.dispose();
		this.panel.remove();
	}
}
