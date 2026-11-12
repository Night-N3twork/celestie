import type {
	DocumentHighlight,
	DocumentLink,
	LinkedEditingRanges,
	OffsetRange,
	SelectionRange,
} from "../api/language-contributions";
import {
	type LanguageContext,
	type LanguageEdit,
	languageProviders,
} from "../api/languages";
import type { Disposable, TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import type { DecorationCollection } from "./decorations";
import type { LanguageFeatureHost } from "./language-host";
import { hasLanguageProvider, requestLanguage } from "./language-request";

export function validOffsetRange(value: OffsetRange, length: number): boolean {
	return (
		!!value &&
		Number.isInteger(value.from) &&
		Number.isInteger(value.to) &&
		value.from >= 0 &&
		value.to >= value.from &&
		value.to <= length
	);
}
export class DocumentContributions implements Disposable {
	private model: TextModel | null = null;
	private highlights: DecorationCollection | undefined;
	private linkMarks: DecorationCollection | undefined;
	private links: readonly DocumentLink[] = [];
	private abort = new AbortController();
	private formatAbort = new AbortController();
	private linkAbort = new AbortController();
	private subscription: Disposable | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ranges: TrackedRange[] = [];
	private wordPattern: RegExp | undefined;
	private history: TextSelection[][] = [];
	private selectionKey = "";
	constructor(private readonly host: LanguageFeatureHost) {
		host.viewport.addEventListener("click", this.click);
	}
	setModel(model: TextModel | null): void {
		this.clear();
		this.model = model;
		if (model) {
			this.highlights = this.host.decorations();
			this.linkMarks = this.host.decorations();
			this.subscription = model.onDidChangeContent((event) => {
				if (event.undoing || event.redoing || event.flush)
					this.endLinked(false);
			});
		}
	}
	private context(signal: AbortSignal): LanguageContext {
		const model = this.host.model();
		if (!model) throw new Error("No document.");
		const selection = this.host.selection();
		return {
			model,
			text: model.getValue({ eol: "\n" }),
			offset:
				selection.direction === "backward"
					? selection.start
					: selection.end,
			signal,
			workspace: this.host.workspace(),
		};
	}
	private valid(context: LanguageContext, version: number): boolean {
		return (
			!context.signal.aborted &&
			this.host.model() === context.model &&
			!context.model.isDisposed() &&
			context.model.getVersionId() === version
		);
	}
	private decoration(range: OffsetRange, className: string, title?: string) {
		const model = this.host.model();
		if (!model) throw new Error("No model");
		const start = model.getPositionAtInputOffset(range.from),
			end = model.getPositionAtInputOffset(range.to);
		return {
			range: {
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
			className,
			...(title ? { hover: title } : {}),
		};
	}
	async refreshLinks(): Promise<void> {
		if (!this.model || this.host.performance().mode === "reduced") return;
		this.linkAbort.abort();
		this.linkAbort = new AbortController();
		const context = this.context(this.linkAbort.signal),
			version = this.model.getVersionId();
		const links = await requestLanguage<readonly DocumentLink[]>(
			"links",
			context,
		);
		if (!this.valid(context, version)) return;
		this.links = links.filter((link) =>
			validOffsetRange(link, context.text.length),
		);
		this.linkMarks?.set(
			this.links.map((link) =>
				this.decoration(
					link,
					"editor-document-link",
					link.tooltip ?? link.target ?? "Open link",
				),
			),
		);
	}
	selectionChanged(): void {
		if (!this.model || this.host.performance().mode === "reduced") return;
		if (this.ranges.length) {
			const selections = this.host.selections(),
				texts = this.ranges.map((tracked) => {
					const range = tracked.getRange();
					return range
						? this.model?.getValueInRange(range)
						: undefined;
				});
			if (
				texts.every(
					(text) => text !== undefined && text === texts[0],
				) &&
				selections.length === this.ranges.length &&
				selections.every((selection, index) => {
					const range = this.ranges[index]?.getRange();
					if (!range) return false;
					const from =
							this.model?.getInputOffsetAt({
								line: range.startLine,
								column: range.startColumn,
							}) ?? 0,
						to =
							this.model?.getInputOffsetAt({
								line: range.endLine,
								column: range.endColumn,
							}) ?? 0;
					return selection.start >= from && selection.end <= to;
				})
			)
				return;
			this.endLinked(false);
		}
		this.abort.abort();
		this.abort = new AbortController();
		if (this.timer) clearTimeout(this.timer);
		this.highlights?.clear();
		this.timer = setTimeout(() => {
			void this.updateSelection().catch(() => {});
		}, 140);
	}
	private async updateSelection(): Promise<void> {
		if (!this.model || this.host.performance().mode === "reduced") return;
		const context = this.context(this.abort.signal),
			version = this.model.getVersionId();
		const values = await requestLanguage<readonly DocumentHighlight[]>(
			"documentHighlights",
			context,
		);
		if (!this.valid(context, version)) return;
		this.highlights?.set(
			values
				.filter((range) => validOffsetRange(range, context.text.length))
				.map((range) =>
					this.decoration(
						range,
						`editor-document-highlight-${range.kind ?? "text"}`,
					),
				),
		);
		if (
			this.host.options().linkedEditing &&
			this.host.selections().length === 1 &&
			this.host.canEdit()
		)
			await this.startLinked();
	}
	async startLinked(): Promise<void> {
		if (
			!this.model ||
			this.host.performance().mode === "reduced" ||
			!this.host.canEdit() ||
			this.host.selections().length !== 1
		)
			return;
		const context = this.context(this.abort.signal),
			version = this.model.getVersionId(),
			selection = this.host.selection(),
			result = await requestLanguage<LinkedEditingRanges | null>(
				"linkedEditing",
				context,
			);
		if (
			!result ||
			!this.valid(context, version) ||
			JSON.stringify(selection) !== JSON.stringify(this.host.selection())
		)
			return;
		const ranges = [...result.ranges].sort((a, b) => a.from - b.from);
		if (
			ranges.length < 2 ||
			ranges.length > 1000 ||
			ranges.some(
				(range, index) =>
					!validOffsetRange(range, context.text.length) ||
					(index > 0 && range.from < (ranges[index - 1]?.to ?? 0)),
			)
		)
			return;
		const source = ranges.find(
			(range) =>
				selection.start >= range.from && selection.end <= range.to,
		);
		if (!source) return;
		const text = context.text.slice(source.from, source.to);
		if (
			ranges.some(
				(range) => context.text.slice(range.from, range.to) !== text,
			)
		)
			return;
		if (result.wordPattern) {
			const pattern = new RegExp(
				`^(?:${result.wordPattern.source})$`,
				result.wordPattern.flags.replace(/[gy]/g, ""),
			);
			if (!pattern.test(text)) return;
		}
		this.wordPattern = result.wordPattern
			? new RegExp(
					`^(?:${result.wordPattern.source})$`,
					result.wordPattern.flags.replace(/[gy]/g, ""),
				)
			: undefined;
		const ordered = [source, ...ranges.filter((range) => range !== source)];
		this.ranges = ordered.map((range) => {
			const start = context.model.getPositionAtInputOffset(range.from),
				end = context.model.getPositionAtInputOffset(range.to);
			return context.model.trackRange(
				{
					startLine: start.line,
					startColumn: start.column,
					endLine: end.line,
					endColumn: end.column,
				},
				{ stickiness: "always" },
			);
		});
		this.host.select(
			ordered.map((range) => ({
				...selection,
				start: range.from + selection.start - source.from,
				end: range.from + selection.end - source.from,
			})),
		);
		this.host.announce(
			"Linked editing active. Escape ends linked editing.",
		);
	}
	beforeInput(text: string): void {
		const range = this.ranges[0]?.getRange(),
			model = this.model;
		if (!range || !model || !this.wordPattern) return;
		const selection = this.host.selection(),
			from = model.getInputOffsetAt({
				line: range.startLine,
				column: range.startColumn,
			}),
			to = model.getInputOffsetAt({
				line: range.endLine,
				column: range.endColumn,
			}),
			source = model.getValue({ eol: "\n" });
		if (
			!this.wordPattern.test(
				source.slice(from, selection.start) +
					text +
					source.slice(selection.end, to),
			)
		)
			this.endLinked();
	}
	endLinked(collapse = true): boolean {
		if (!this.ranges.length) return false;
		for (const range of this.ranges) range.dispose();
		this.ranges = [];
		this.wordPattern = undefined;
		if (collapse && this.model === this.host.model()) {
			const primary = this.host.selections()[0];
			if (primary) this.host.select([primary]);
		}
		return true;
	}
	async expand(shrink: boolean): Promise<void> {
		if (!this.model || this.host.performance().mode === "reduced") return;
		const selections = this.host.selections();
		if (this.selectionKey !== JSON.stringify(selections)) this.history = [];
		if (shrink) {
			const previous = this.history.pop();
			if (previous) this.host.select(previous);
			this.selectionKey = JSON.stringify(this.host.selections());
			return;
		}
		const context = this.context(this.abort.signal),
			version = this.model.getVersionId(),
			result = await requestLanguage<readonly SelectionRange[]>(
				"selectionRanges",
				context,
				{
					offsets: selections.map((s) =>
						s.direction === "backward" ? s.start : s.end,
					),
				},
			);
		if (
			!this.valid(context, version) ||
			JSON.stringify(selections) !==
				JSON.stringify(this.host.selections()) ||
			result.length !== selections.length
		)
			return;
		const next = selections.map((selection, index) => {
			let range = result[index];
			for (
				let depth = 0;
				range && depth < 100;
				depth++, range = range.parent
			) {
				if (!validOffsetRange(range, context.text.length)) break;
				if (
					range.from <= selection.start &&
					range.to >= selection.end &&
					(range.from < selection.start || range.to > selection.end)
				)
					return { ...selection, start: range.from, end: range.to };
			}
			return selection;
		});
		this.history.push([...selections]);
		if (this.history.length > 100) this.history.shift();
		this.host.select(next);
		this.selectionKey = JSON.stringify(next);
	}
	onType(character: string): void {
		if (
			[...character].length !== 1 ||
			!this.model ||
			!this.host.options().onTypeFormatting ||
			this.host.performance().mode === "reduced" ||
			!this.host.canEdit() ||
			this.host.selections().length !== 1
		)
			return;
		const configured = languageProviders(this.model.getLanguageId()).find(
			(provider) => provider.onTypeFormat,
		);
		if (
			configured?.onTypeFormattingCharacters &&
			!configured.onTypeFormattingCharacters.includes(character)
		)
			return;
		this.formatAbort.abort();
		this.formatAbort = new AbortController();
		const context = this.context(this.formatAbort.signal),
			version = this.model.getVersionId(),
			selection = JSON.stringify(this.host.selection());
		void requestLanguage<readonly LanguageEdit[]>("onTypeFormat", context, {
			character,
		})
			.then((edits) => {
				if (
					this.valid(context, version) &&
					selection === JSON.stringify(this.host.selection()) &&
					this.host.canEdit()
				)
					this.host.applyTyping(edits, version);
			})
			.catch(() => {});
	}
	hasSelectionRanges(): boolean {
		return (
			!!this.model &&
			this.host.performance().mode === "full" &&
			hasLanguageProvider(this.model, "selectionRanges")
		);
	}
	private readonly click = (event: MouseEvent) => {
		if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
		const offset = this.host.offsetAtPoint(event.clientX, event.clientY),
			link = this.links.find(
				(link) => offset >= link.from && offset < link.to,
			);
		if (!link) return;
		event.preventDefault();
		const context = this.context(this.abort.signal),
			version = context.model.getVersionId();
		void requestLanguage<DocumentLink | null>("resolveLink", context, {
			item: link,
		})
			.then((resolved) => {
				const target = resolved?.target ?? link.target;
				if (target && this.valid(context, version))
					this.host.openLink(target);
			})
			.catch((error) => this.host.announce(String(error)));
	};
	cancel(): void {
		this.changed();
		this.endLinked();
		if (this.timer) clearTimeout(this.timer);
	}
	changed(): void {
		this.linkAbort.abort();
		this.abort.abort();
		this.abort = new AbortController();
		this.formatAbort.abort();
		this.history = [];
		this.highlights?.clear();
		this.linkMarks?.clear();
		this.links = [];
	}
	private clear(): void {
		this.subscription?.dispose();
		this.subscription = undefined;
		this.changed();
		if (this.timer) clearTimeout(this.timer);
		this.endLinked(false);
		this.highlights?.dispose();
		this.linkMarks?.dispose();
		this.highlights = undefined;
		this.linkMarks = undefined;
	}
	dispose(): void {
		this.clear();
		this.model = null;
		this.host.viewport.removeEventListener("click", this.click);
	}
}
