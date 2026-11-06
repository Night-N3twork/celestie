import type {
	Analysis,
	CodeAction,
	Completion,
	Diagnostic,
	Hover,
	LanguageContext,
	LanguageEdit,
	Location,
	SymbolInformation,
} from "../api/languages";
import { getLanguage } from "../api/languages";
import { onDidChangeTokenizers } from "../api/tokenization";
import type { Disposable } from "../api/types";
import { languageEngine } from "../languages/client";
import { getLanguageConfiguration, isWord } from "../languages/configuration";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import { prepareCompletions } from "./completion-items";
import { showColorPicker, showRename } from "./language-dialogs";
import type { LanguageFeatureHost as Host } from "./language-host";
import { LanguagePopup } from "./language-popup";
import { requestLanguage } from "./language-request";

export class LanguageFeatures implements Disposable {
	private readonly popup: LanguagePopup;
	private get widget() {
		return this.popup.widget;
	}
	private get ghost() {
		return this.popup.ghost;
	}
	private get choices() {
		return this.popup.choices;
	}
	private get index() {
		return this.popup.index;
	}
	private set index(v: number) {
		this.popup.index = v;
	}
	private readonly status: HTMLButtonElement;
	private subscriptions: Disposable[] = [];
	private abort = new AbortController();
	private analysisAbort = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private completions: readonly Completion[] = [];
	private completionContext:
		| { context: LanguageContext; version: number }
		| undefined;
	private readonly commitAnchors = new Set<TrackedRange>();
	private readonly resolved = new WeakMap<
		Completion,
		{ detail: string; edits: readonly LanguageEdit[] }
	>();

	private disposed = false;
	private lastAnalysis: Analysis = {
		tokens: [],
		diagnostics: [],
		folds: [],
		symbols: [],
	};
	private inline = "";
	private inlineVersion = 0;
	private inlineOffset = -1;
	constructor(private readonly host: Host) {
		this.popup = new LanguagePopup({
			...host,
			onClose: (clearInline) => {
				this.completions = [];
				this.completionContext = undefined;
				if (clearInline) this.inline = "";
			},
		});
		const doc = host.frame.ownerDocument;
		this.status = doc.createElement("button");
		this.status.type = "button";
		this.status.className = "editor-language-status";
		this.status.textContent = "Checking…";
		this.status.title = "Show problems";

		this.status.onclick = () => void this.run("problems");
		host.frame.append(this.status);
		host.input.addEventListener("keydown", this.keydown, true);
		host.input.addEventListener("beforeinput", this.beforeInput);
		host.viewport.addEventListener("pointermove", this.pointerMove);
		host.viewport.addEventListener("pointerleave", this.pointerLeave);
		this.widget.addEventListener("keydown", this.keydown);
	}
	setModel(model: TextModel | null): void {
		this.cancelRequests();
		for (const sub of this.subscriptions.splice(0)) sub.dispose();
		this.abort.abort();
		this.analysisAbort.abort();
		this.close();
		this.lastAnalysis = {
			tokens: [],
			diagnostics: [],
			folds: [],
			symbols: [],
		};
		if (this.timer) clearTimeout(this.timer);
		if (model) {
			this.subscriptions.push(
				onDidChangeTokenizers(() => this.changed()),
				languageEngine.attach(model),
				model.onDidChangeContent(() => this.changed()),
				model.onDidChangeLanguage(() => this.changed()),
			);
			this.changed();
		} else this.status.textContent = "No document";
	}
	refresh(): void {
		this.changed();
	}
	cancelRequests(): void {
		this.abort.abort();
		for (const anchor of this.commitAnchors) anchor.dispose();
		this.commitAnchors.clear();
		this.close();
	}
	updateStatus(diagnostics: readonly Diagnostic[]): void {
		const errors = diagnostics.filter(
				(diagnostic) => diagnostic.severity === "error",
			).length,
			warnings = diagnostics.filter(
				(diagnostic) => diagnostic.severity === "warning",
			).length,
			paused = diagnostics.find(
				(diagnostic) => diagnostic.source === "Editor",
			);
		this.status.textContent = paused
			? "Syntax only"
			: errors || warnings
				? `${errors} errors · ${warnings} warnings`
				: "No problems";
		this.status.title = paused?.message ?? "Show problems";
	}

	private changed(): void {
		this.close();
		this.analysisAbort.abort();
		this.analysisAbort = new AbortController();
		if (this.timer) clearTimeout(this.timer);
		this.status.textContent = "Checking…";
		this.timer = setTimeout(() => void this.analyze(), 180);
	}
	private context(signal: AbortSignal): LanguageContext {
		const model = this.host.model();
		if (!model) throw new Error("No document attached.");
		const selection = this.host.selection();
		return {
			model,
			text: model.getValue({ eol: "\n" }),
			offset:
				selection.direction === "backward"
					? selection.start
					: selection.end,
			signal,
		};
	}
	private async request<T>(
		method: string,
		context: LanguageContext,
		extra: Record<string, unknown> = {},
	): Promise<T> {
		return requestLanguage<T>(method, context, extra);
	}
	private valid(context: LanguageContext, version: number): boolean {
		return (
			!this.disposed &&
			!context.signal.aborted &&
			this.host.model() === context.model &&
			!context.model.isDisposed() &&
			context.model.getVersionId() === version
		);
	}
	private async analyze(): Promise<void> {
		try {
			const context = this.context(this.analysisAbort.signal),
				version = context.model.getVersionId(),
				result = await this.request<Analysis>(
					"analyze",
					context,
					this.host.analysisOptions(),
				);
			if (!this.valid(context, version)) return;
			this.lastAnalysis = result;
			this.host.analysis(result);
			this.updateStatus(this.host.diagnostics());
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				return;
			if (!this.disposed) {
				this.status.textContent = "Language assistance unavailable";
				this.status.title = String(error);
			}
		}
	}
	async run(command: string): Promise<void> {
		if (this.hoverTimer) clearTimeout(this.hoverTimer);
		if (command === "close") {
			this.close();
			return;
		}
		if (command === "snippet") {
			this.snippets();
			return;
		}
		if (command === "problems") {
			this.problems();
			return;
		}
		if (command === "color") {
			this.colorPicker();
			return;
		}
		if (command === "symbols") {
			this.symbols();
			return;
		}
		this.abort.abort();
		this.abort = new AbortController();
		try {
			const context = this.context(this.abort.signal),
				version = context.model.getVersionId();
			if (command === "rename") {
				this.rename(context, version);
				return;
			}
			if (command === "complete" || command === "inline") {
				const { prefix, ordered } = prepareCompletions(
					context,
					await this.request<readonly Completion[]>(
						"complete",
						context,
					),
				);
				if (
					!this.valid(context, version) ||
					!this.caretAt(context.offset)
				)
					return;
				if (command === "inline") {
					const suggestion = ordered.find(
						(entry) =>
							!entry.snippet &&
							!entry.source &&
							!entry.additionalEdits?.length &&
							entry.insertText.startsWith(prefix) &&
							entry.insertText.length > prefix.length,
					);
					if (!suggestion) {
						this.host.announce("No inline suggestion.");
						return;
					}
					this.inline = suggestion.insertText.slice(prefix.length);
					this.inlineVersion = version;
					this.inlineOffset = context.offset;
					this.popup.position(this.ghost, context.offset);
					this.ghost.textContent = this.inline;
					this.ghost.hidden = false;
					return;
				}
				this.completions = ordered.slice(0, 100);
				this.popup.showChoices(
					"complete",
					this.completions.map((item) => ({
						label: item.label,
						detail: item.detail ?? item.kind ?? "",
						run: () => {
							void this.acceptResolved(item, context, version);
						},
					})),
					context.offset,
				);
				this.completions = ordered.slice(0, 100);
				this.resolveActive();
				this.completionContext = { context, version };
				return;
			}
			if (command === "hover") {
				const result = await this.request<Hover | null>(
					"hover",
					context,
				);
				if (this.valid(context, version))
					this.showHover(context.offset, result);
				return;
			}
			if (command === "signature") {
				const result = await this.request<string | null>(
					"signature",
					context,
				);
				if (this.valid(context, version) && result)
					this.popup.showText(
						"Signature help",
						result,
						context.offset,
					);
				return;
			}
			if (command === "definitions" || command === "references") {
				const result = await this.request<readonly Location[]>(
					command,
					context,
				);
				if (!this.valid(context, version)) return;
				if (command === "definitions" && result.length === 1) {
					const location = result[0];
					if (location) this.host.open(location);
					return;
				}
				this.popup.showChoices(
					command,
					result.map((location) => ({
						label:
							location.label ?? location.preview ?? location.uri,
						detail: location.uri,
						run: () => this.host.open(location),
					})),
					context.offset,
					true,
				);
				return;
			}
			if (command === "format" || command === "formatSelection") {
				if (!this.host.canEdit()) return;
				const selection = this.host.selection(),
					result = await this.request<readonly LanguageEdit[]>(
						"format",
						context,
						command === "formatSelection"
							? {
									range: {
										from: selection.start,
										to: selection.end,
									},
								}
							: {},
					);
				if (this.valid(context, version)) await this.host.apply(result);
				return;
			}
			if (command === "actions") {
				const result = await this.request<readonly CodeAction[]>(
					"actions",
					context,
				);
				if (!this.valid(context, version)) return;
				this.popup.showChoices(
					"actions",
					result.map((action) => ({
						label: action.title,
						run: () => {
							if (
								this.valid(context, version) &&
								this.host.canEdit()
							)
								void Promise.resolve()
									.then(() => {
										if (
											this.valid(context, version) &&
											this.host.canEdit()
										)
											return this.host.apply(action);
									})
									.catch((error) =>
										this.host.announce(String(error)),
									);
						},
					})),
					context.offset,
					true,
				);
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError"))
				this.host.announce(
					error instanceof Error ? error.message : String(error),
				);
		}
	}
	private async resolveItem(
		item: Completion,
		context: LanguageContext,
	): Promise<{ detail: string; edits: readonly LanguageEdit[] } | null> {
		const old = this.resolved.get(item);
		if (old) return old;
		const result = await this.request<{
			detail: string;
			edits: readonly LanguageEdit[];
		} | null>("resolveCompletion", context, {
			name: item.label,
			source: item.source,
			data: item.data,
			item,
		});
		if (result) this.resolved.set(item, result);
		return result;
	}
	private async acceptResolved(
		item: Completion,
		context: LanguageContext,
		version: number,
		commitCharacter?: string,
	): Promise<void> {
		const point = context.model.getPositionAtInputOffset(context.offset);
		const selection = JSON.stringify(this.host.selection());
		const anchor = commitCharacter
			? context.model.trackRange(
					{
						startLine: point.line,
						startColumn: point.column,
						endLine: point.line,
						endColumn: point.column,
					},
					{ stickiness: "before" },
				)
			: undefined;
		let accepted = false;
		if (anchor) this.commitAnchors.add(anchor);
		if (commitCharacter) this.close();
		try {
			const result = await this.resolveItem(item, context);
			if (
				this.valid(context, version) &&
				this.host.canEdit() &&
				JSON.stringify(this.host.selection()) === selection
			) {
				this.host.accept(
					{
						...item,
						...(result?.edits.length
							? { additionalEdits: result.edits }
							: {}),
					},
					commitCharacter,
				);
				accepted = true;
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError"))
				this.host.announce(String(error));
		} finally {
			const range = anchor?.getRange();
			anchor?.dispose();
			if (anchor) this.commitAnchors.delete(anchor);
			if (
				commitCharacter &&
				!accepted &&
				range &&
				!this.disposed &&
				this.host.model() === context.model &&
				this.host.canEdit()
			) {
				const offset = context.model.getInputOffsetAt({
					line: range.startLine,
					column: range.startColumn,
				});
				this.host.apply([
					{
						uri: context.model.uri.toString(),
						from: offset,
						to: offset,
						text: commitCharacter,
					},
				]);
			}
		}
	}
	private resolveActive(): void {
		const item = this.completions[this.index];
		if (!item || this.widget.hidden) return;
		let context: LanguageContext;
		try {
			context = this.context(this.abort.signal);
		} catch {
			return;
		}
		const version = context.model.getVersionId();
		void this.resolveItem(item, context)
			.then((result) => {
				if (
					!result ||
					!this.valid(context, version) ||
					this.widget.hidden ||
					this.completions[this.index] !== item
				)
					return;
				let detail = this.widget.querySelector<HTMLPreElement>(
					".editor-completion-detail",
				);
				if (!detail) {
					detail = this.widget.ownerDocument.createElement("pre");
					detail.className = "editor-completion-detail";
					this.widget.append(detail);
				}
				detail.textContent = result.detail;
			})
			.catch(() => {});
	}

	private showHover(offset: number, result: Hover | null): void {
		const diagnostics = this.lastAnalysis.diagnostics
			.filter((item) => offset >= item.from && offset <= item.to)
			.map((item) => item.message);
		const text = [...diagnostics, result?.text]
			.filter(Boolean)
			.join("\n\n");
		if (text) this.popup.showText("Hover", text, offset);
	}
	private rename(context: LanguageContext, version: number): void {
		showRename(
			{
				editor: this.host,
				popup: this.popup,
				analysis: this.lastAnalysis,
				request: <T>(
					m: string,
					c: LanguageContext,
					e?: Record<string, unknown>,
				) => this.request<T>(m, c, e),
				valid: (c, v) => this.valid(c, v),
			},
			context,
			version,
		);
	}
	private colorPicker(): void {
		showColorPicker({
			editor: this.host,
			popup: this.popup,
			analysis: this.lastAnalysis,
			request: <T>(
				m: string,
				c: LanguageContext,
				e?: Record<string, unknown>,
			) => this.request<T>(m, c, e),
			valid: (c, v) => this.valid(c, v),
		});
	}

	offerSnippetChoices(choices: readonly string[]): void {
		const selection = this.host.selection();
		this.popup.showChoices(
			"snippet-choices",
			choices.map((text) => ({
				label: text,
				run: () =>
					this.host.accept({
						label: text,
						insertText: text,
						from: selection.start,
						to: selection.end,
					}),
			})),
			selection.end,
		);
	}

	private symbols(): void {
		const flatten = (
			symbols: readonly SymbolInformation[],
		): SymbolInformation[] =>
			symbols.flatMap((symbol) => [
				symbol,
				...flatten(symbol.children ?? []),
			]);
		this.popup.showChoices(
			"symbols",
			flatten(this.lastAnalysis.symbols).map((symbol) => ({
				label: symbol.label ?? "Symbol",
				detail: symbol.kind,
				run: () => this.host.open(symbol),
			})),
			this.context(this.abort.signal).offset,
			true,
		);
	}
	private problems(): void {
		const model = this.host.model();
		if (!model) return;
		this.popup.showChoices(
			"problems",
			this.host.diagnostics().map((item) => ({
				label: item.message,
				detail: `${item.severity} · ${item.source ?? model.getLanguageId()}`,
				run: () =>
					this.host.open({
						uri: model.uri.toString(),
						from: item.from,
						to: item.to,
					}),
			})),
			this.host.selection().end,
			true,
		);
	}
	private snippets(): void {
		const snippets =
			getLanguage(this.host.model()?.getLanguageId() ?? "")?.snippets ??
			[];
		if (!snippets.length) {
			this.host.announce("No snippets for this language.");
			return;
		}
		this.popup.showChoices(
			"snippets",
			snippets.map((snippet) => ({
				label: snippet.description ?? snippet.label,
				run: () => this.host.snippet(snippet.body),
			})),
			this.host.selection().end,
			true,
		);
	}
	peek(location: Location): void {
		this.popup.showText(
			location.label ?? "Definition",
			location.preview ?? location.uri,
			this.host.selection().end,
		);
	}
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.isComposing) return;
		if (event.key === "Escape" && this.commitAnchors.size) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.host.cancelSnippet();
			this.cancelRequests();
			return;
		}
		const item = this.completions[this.index],
			request = this.completionContext;
		if (
			!this.widget.hidden &&
			item &&
			request &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			[...event.key].length === 1 &&
			item.commitCharacters?.includes(event.key) &&
			this.host.canEdit()
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			void this.acceptResolved(
				item,
				request.context,
				request.version,
				event.key,
			);
			return;
		}
		if (event.key === "Escape") this.host.cancelSnippet();
		if (event.key === "Escape" && (!this.widget.hidden || this.inline)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.abort.abort();
			this.close();
			this.host.input.focus({ preventScroll: true });
			return;
		}
		if (
			!this.widget.hidden &&
			this.choices.length &&
			["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.key === "Enter" || event.key === "Tab")
				this.popup.acceptChoice(this.index);
			else {
				this.index =
					(this.index +
						(event.key === "ArrowDown" ? 1 : -1) +
						this.choices.length) %
					this.choices.length;
				const options =
					this.widget.querySelectorAll<HTMLElement>(
						'[role="option"]',
					);
				options.forEach((option, index) => {
					option.setAttribute(
						"aria-selected",
						String(index === this.index),
					);
				});
				options[this.index]?.scrollIntoView({ block: "nearest" });
				this.resolveActive();
				this.host.input.setAttribute(
					"aria-activedescendant",
					`${this.widget.id}-${this.index}`,
				);
			}
			return;
		}
		if (
			this.inline &&
			(event.key === "Tab" ||
				(event.ctrlKey && event.key === "ArrowRight"))
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			const model = this.host.model();
			let remaining = "";
			if (model && model.getVersionId() === this.inlineVersion) {
				const offset = this.host.selection().end,
					text =
						event.key === "Tab"
							? this.inline
							: (this.inline.match(/^\W*\w+\W*/)?.[0] ??
								this.inline);
				remaining = this.inline.slice(text.length);
				this.host.apply([
					{
						uri: model.uri.toString(),
						from: offset,
						to: offset,
						text,
						version: model.getVersionId(),
					},
				]);
			}
			this.inline = remaining;
			this.inlineVersion = model?.getVersionId() ?? 0;
			this.inlineOffset = this.host.selection().end;
			this.ghost.textContent = remaining;
			this.ghost.hidden = !remaining;
			if (remaining)
				this.popup.position(this.ghost, this.host.selection().end);
			return;
		}
		if (event.key === "Tab" && this.host.nextSnippet(event.shiftKey)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (
			[
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"Home",
				"End",
			].includes(event.key)
		) {
			this.close();
			this.abort.abort();
		}
	};
	private readonly beforeInput = (event: InputEvent): void => {
		if (event.isComposing || !this.host.canEdit()) return;
		const data = event.data;
		if (event.inputType === "insertText" && data)
			queueMicrotask(() => {
				if (this.disposed) return;
				if (data === "(" || data === ",") void this.run("signature");
				else if (
					data === "." ||
					isWord(
						getLanguageConfiguration(
							this.host.model()?.getLanguageId() ?? "",
						),
						data,
					)
				)
					void this.run("complete");
			});
	};
	private readonly pointerMove = (event: PointerEvent): void => {
		if (event.buttons || (!this.widget.hidden && this.choices.length))
			return;
		if (this.hoverTimer) clearTimeout(this.hoverTimer);
		const offset = this.host.offsetAtPoint(event.clientX, event.clientY);
		this.hoverTimer = setTimeout(() => {
			if (!this.widget.hidden && this.choices.length) return;
			this.abort.abort();
			this.abort = new AbortController();
			let context: LanguageContext;
			try {
				context = { ...this.context(this.abort.signal), offset };
			} catch {
				return;
			}
			const version = context.model.getVersionId();
			void this.request<Hover | null>("hover", context)
				.then((result) => {
					if (this.valid(context, version))
						this.showHover(offset, result);
				})
				.catch(() => {});
		}, 450);
	};
	private readonly pointerLeave = (): void => {
		if (this.hoverTimer) clearTimeout(this.hoverTimer);
	};
	close(clearInline = true): void {
		this.popup.close(clearInline);
	}
	private caretAt(offset: number): boolean {
		const selection = this.host.selection();
		return selection.start === offset && selection.end === offset;
	}
	selectionChanged(): void {
		const completion = this.completionContext?.context.offset;
		if (
			(completion !== undefined && !this.caretAt(completion)) ||
			(this.inline && !this.caretAt(this.inlineOffset))
		) {
			this.abort.abort();
			this.close();
		}
	}
	dispose(): void {
		this.disposed = true;
		this.cancelRequests();
		this.abort.abort();
		this.analysisAbort.abort();
		if (this.timer) clearTimeout(this.timer);
		if (this.hoverTimer) clearTimeout(this.hoverTimer);
		for (const sub of this.subscriptions.splice(0)) sub.dispose();
		this.host.input.removeEventListener("keydown", this.keydown, true);
		this.host.input.removeEventListener("beforeinput", this.beforeInput);
		this.host.viewport.removeEventListener("pointermove", this.pointerMove);
		this.host.viewport.removeEventListener(
			"pointerleave",
			this.pointerLeave,
		);
		this.widget.removeEventListener("keydown", this.keydown);

		this.popup.dispose();

		this.status.remove();
	}
}
