import type {
	InlineCompletion,
	InlineCompletionList,
} from "../api/language-contributions";
import type { LanguageContext } from "../api/languages";
import { validOffsetRange } from "./document-contributions";
import type { LanguageFeatureHost } from "./language-host";
import type { LanguagePopup } from "./language-popup";

export class InlineSuggestions {
	private items: readonly InlineCompletion[] = [];
	private release: (() => void) | undefined;
	private context: LanguageContext | undefined;
	private version = 0;
	private offset = -1;
	private index = 0;
	constructor(
		private readonly host: LanguageFeatureHost,
		private readonly popup: LanguagePopup,
	) {}
	get active(): boolean {
		return this.items.length > 0;
	}
	show(
		context: LanguageContext,
		version: number,
		result: readonly InlineCompletion[] | InlineCompletionList,
	): void {
		this.clear();
		const items = "items" in result ? result.items : result;
		if ("items" in result) this.release = () => result.dispose();
		if (
			context.signal.aborted ||
			this.host.model() !== context.model ||
			context.model.getVersionId() !== version ||
			this.host.selection().end !== context.offset
		) {
			this.clear();
			return;
		}
		this.items = items.filter(
			(item) =>
				validOffsetRange(item, context.text.length) &&
				item.from <= context.offset &&
				item.to >= context.offset &&
				item.insertText.startsWith(
					context.text.slice(item.from, context.offset),
				) &&
				item.insertText.length > context.offset - item.from,
		);
		this.context = context;
		this.version = version;
		this.offset = context.offset;
		this.index = 0;
		if (!this.items.length) {
			this.clear();
			this.host.announce("No inline suggestion.");
			return;
		}
		this.paint();
	}
	private paint(): void {
		const item = this.items[this.index];
		if (!item) return;
		this.popup.ghost.textContent = item.insertText.slice(
			this.offset - item.from,
		);
		this.popup.ghost.hidden = false;
		this.popup.position(this.popup.ghost, this.offset);
	}
	cycle(direction: number): void {
		if (!this.items.length) return;
		this.index =
			(this.index + direction + this.items.length) % this.items.length;
		this.paint();
		this.host.announce(
			`Inline suggestion ${this.index + 1} of ${this.items.length}`,
		);
	}
	accept(partial = false): void {
		const context = this.context,
			item = this.items[this.index],
			selection = this.host.selection();
		if (
			!context ||
			context.signal.aborted ||
			!item ||
			!this.host.canEdit() ||
			this.host.model() !== context.model ||
			context.model.getVersionId() !== this.version ||
			selection.start !== this.offset ||
			selection.end !== this.offset
		) {
			this.clear();
			return;
		}
		const tail = item.insertText.slice(this.offset - item.from);
		if (
			partial &&
			item.to === this.offset &&
			!item.additionalEdits?.length
		) {
			const part = tail.match(/^\s*[^\s]+[\t ]*/u)?.[0] ?? tail;
			this.host.accept({
				label: item.label ?? "Inline suggestion",
				from: this.offset,
				to: this.offset,
				insertText: part,
			});
			const remaining = tail.slice(part.length);
			if (remaining) {
				this.items = [
					{
						from: this.host.selection().end,
						to: this.host.selection().end,
						insertText: remaining,
					},
				];
				this.index = 0;
				this.offset = this.host.selection().end;
				this.version = context.model.getVersionId();
				this.context = {
					...context,
					text: context.model.getValue({ eol: "\n" }),
					offset: this.offset,
				};
				this.paint();
			} else this.clear();
			return;
		}
		this.host.accept({
			label: item.label ?? "Inline suggestion",
			from: item.from,
			to: item.to,
			insertText: item.insertText,
			...(item.additionalEdits
				? { additionalEdits: item.additionalEdits }
				: {}),
		});
		this.clear();
	}
	selectionChanged(): void {
		const selection = this.host.selection();
		if (
			this.active &&
			(selection.start !== this.offset || selection.end !== this.offset)
		)
			this.clear();
	}
	clear(): void {
		this.items = [];
		this.context = undefined;
		this.popup.ghost.hidden = true;
		const release = this.release;
		this.release = undefined;
		try {
			release?.();
		} catch (error) {
			console.warn("Inline suggestion cleanup failed", error);
		}
	}
}
