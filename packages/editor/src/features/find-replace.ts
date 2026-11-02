import type { Disposable, TextSelection } from "../api/types";
import type { KeyboardShortcuts } from "./keyboard-shortcuts";
import { findLiteralMatches, type SearchMatch } from "./search";

export interface SearchEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

interface FindReplaceHost {
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
		this.query.placeholder = "Find (literal, case-sensitive)";
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
		this.panel.append(findRow, this.replacementRow);
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
		const selection = this.host.getSelection();
		const seed = this.host.getText().slice(selection.start, selection.end);
		if (!this.isOpen && seed && !seed.includes("\n"))
			this.query.value = seed;
		this.panel.hidden = false;
		if (replace) this.replacementRow.hidden = false;
		this.refresh(true);
		this.query.focus();
		this.query.select();
	}

	close(): void {
		this.panel.hidden = true;
		this.host.highlight([], -1);
		this.host.focusEditor();
	}

	refresh(select = false, anchor = this.host.getSelection().start): void {
		if (this.disposed || !this.isOpen) return;
		const result = findLiteralMatches(
			this.host.getText(),
			this.query.value,
		);
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
