import type {
	CompletionList,
	Documentation,
	InlineCompletion,
	InlineCompletionList,
	LanguageTrigger,
	SignatureHelp,
} from "../api/language-contributions";
import type {
	Analysis,
	CodeLens,
	Completion,
	Diagnostic,
	Hover,
	InlayHint,
	LanguageContext,
	LanguageEdit,
	Location,
	SymbolInformation,
} from "../api/languages";
import {
	getLanguage,
	languageProviders,
	onDidChangeLanguageProviders,
} from "../api/languages";
import { onDidChangeTokenizers } from "../api/tokenization";
import type { Disposable } from "../api/types";
import { languageEngine } from "../languages/client";
import { getLanguageConfiguration, isWord } from "../languages/configuration";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import { prepareCompletions } from "./completion-items";
import { DocumentContributions } from "./document-contributions";
import { renderDocumentation } from "./documentation";
import { InlineSuggestions } from "./inline-suggestions";
import { showColorPicker, showRename } from "./language-dialogs";
import type { LanguageFeatureHost as Host } from "./language-host";
import { LanguageNavigation } from "./language-navigation";
import { LanguagePopup } from "./language-popup";
import {
	hasLanguageProvider,
	requestAnalysis,
	requestLanguage,
} from "./language-request";
import { SemanticContributions } from "./semantic-contributions";
import { showSignatures } from "./signature-help";

export class LanguageFeatures implements Disposable {
	private readonly popup: LanguagePopup;
	private get widget() {
		return this.popup.widget;
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
	private triggerTimer: ReturnType<typeof setTimeout> | undefined;
	private completions: readonly Completion[] = [];
	private completionContext:
		| { context: LanguageContext; version: number }
		| undefined;
	private readonly commitAnchors = new Set<TrackedRange>();
	private resolved = new WeakMap<
		Completion,
		{
			model: TextModel;
			version: number;
			result: {
				detail: string;
				edits: readonly LanguageEdit[];
				documentation?: Documentation;
			};
		}
	>();

	private disposed = false;
	private lastAnalysis: Analysis = {
		tokens: [],
		diagnostics: [],
		folds: [],
		symbols: [],
	};
	private readonly inlineSuggestions: InlineSuggestions;
	private readonly contributions: DocumentContributions;
	private readonly navigation: LanguageNavigation;
	private completionIncomplete = false;
	private readonly semantic = new SemanticContributions();
	constructor(private readonly host: Host) {
		this.popup = new LanguagePopup({
			...host,
			onClose: (clearInline) => {
				this.completions = [];
				this.completionContext = undefined;
				this.completionIncomplete = false;
				if (clearInline) this.inlineSuggestions?.clear();
			},
		});
		this.inlineSuggestions = new InlineSuggestions(host, this.popup);
		this.contributions = new DocumentContributions(host);
		this.navigation = new LanguageNavigation(host, this.popup);
		const doc = host.frame.ownerDocument;
		this.status = doc.createElement("button");
		this.status.type = "button";
		this.status.className = "editor-language-status";
		this.status.textContent = "Checking…";
		this.status.title = "Show problems";

		this.status.onclick = () => void this.run("problems");
		host.frame.append(this.status);
		host.input.addEventListener("keydown", this.keydown, true);
		host.input.addEventListener("beforeinput", this.beforeInput, true);
		host.input.addEventListener(
			"compositionstart",
			this.compositionStart,
			true,
		);
		host.input.addEventListener("compositionend", this.compositionEnd);
		host.viewport.addEventListener("pointermove", this.pointerMove);
		host.viewport.addEventListener("pointerleave", this.pointerLeave);
		this.widget.addEventListener("keydown", this.keydown);
	}
	setModel(model: TextModel | null): void {
		this.cancelRequests();
		this.resolved = new WeakMap();
		this.contributions.setModel(model);
		this.navigation.cancel();
		this.semantic.clear();
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
				onDidChangeLanguageProviders(() => {
					this.resolved = new WeakMap();
					this.cancelRequests();
					this.navigation.clear();
					this.semantic.clear();
					this.changed();
				}),
				languageEngine.attach(model),
				model.onDidChangeContent(() => {
					this.navigation.clear();
					this.changed();
				}),
				model.onDidChangeLanguage(() => {
					this.cancelRequests();
					this.semantic.clear();
					this.navigation.clear();
					this.changed();
				}),
			);
			this.changed();
		} else this.status.textContent = "No document";
	}
	refresh(): void {
		this.changed();
	}
	async activateLens(lens: CodeLens): Promise<void> {
		try {
			const context = this.context(this.analysisAbort.signal),
				version = context.model.getVersionId(),
				resolved =
					(await this.request<CodeLens | null>(
						"resolveCodeLens",
						context,
						{ item: lens },
					)) ?? lens;
			if (this.valid(context, version) && resolved.command)
				await this.host.execute(resolved.command);
		} catch (error) {
			if (!this.disposed) this.host.announce(String(error));
		}
	}
	async activateHint(hint: InlayHint, index?: number): Promise<void> {
		try {
			const context = this.context(this.analysisAbort.signal),
				version = context.model.getVersionId(),
				resolved =
					(await this.request<InlayHint | null>(
						"resolveInlayHint",
						context,
						{ item: hint },
					)) ?? hint;
			if (!this.valid(context, version)) return;
			const part = resolved.label?.[index ?? 0];
			if (part?.command) await this.host.execute(part.command);
			else if (part?.location) this.host.open(part.location);
			else
				this.popup.showText(
					"Inlay hint",
					part?.tooltip ?? resolved.tooltip ?? resolved.text,
					hint.offset,
				);
		} catch (error) {
			if (!this.disposed) this.host.announce(String(error));
		}
	}
	cancelRequests(): void {
		if (this.triggerTimer) clearTimeout(this.triggerTimer);
		this.contributions.cancel();
		this.navigation.cancel();
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
				? `${errors} errors - ${warnings} warnings`
				: "No problems";
		this.status.title = paused?.message ?? "Show problems";
	}

	private changed(): void {
		this.close();
		this.contributions.changed();
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
			workspace: this.host.workspace(),
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
			const model = this.host.model();
			if (model && this.host.performance().mode === "reduced") {
				const result: Analysis = {
					tokens: [],
					diagnostics: [
						{
							from: 0,
							to: Math.min(
								1,
								model.getValueLength({ eol: "\n" }),
							),
							severity: "info",
							source: "Editor",
							message:
								"File optimizations pause language assistance, smart pairing, wrapping and minimap.",
						},
					],
					folds: [],
					symbols: [],
					unicodeHighlights: [],
				};
				this.lastAnalysis = result;
				this.host.analysis(result);
				this.status.textContent = "Large file";
				this.status.title = result.diagnostics[0]?.message ?? "";
				return;
			}
			const context = this.context(this.analysisAbort.signal),
				version = context.model.getVersionId(),
				result = await requestAnalysis(
					context,
					this.host.analysisOptions(),
					this.semantic,
				);
			if (!this.valid(context, version)) return;
			this.lastAnalysis = result;
			this.host.analysis(result);
			void this.contributions.refreshLinks().catch(() => {});
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
	async run(command: string, trigger?: LanguageTrigger): Promise<void> {
		if (this.disposed) return;
		if (
			this.host.model() &&
			this.host.performance().mode === "reduced" &&
			!["close", "problems", "snippet"].includes(command)
		) {
			this.host.announce(
				"Language assistance is paused by file optimizations.",
			);
			return;
		}
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
		if (command === "nextLocation" || command === "previousLocation") {
			this.navigation.next(command === "nextLocation" ? 1 : -1);
			return;
		}
		if (command === "nextDiagnostic" || command === "previousDiagnostic") {
			this.navigation.diagnostic(command === "nextDiagnostic" ? 1 : -1);
			return;
		}
		if (command === "inlineNext" || command === "inlinePrevious") {
			this.inlineSuggestions.cycle(command === "inlineNext" ? 1 : -1);
			return;
		}
		if (command === "acceptInline" || command === "acceptInlineWord") {
			this.inlineSuggestions.accept(command === "acceptInlineWord");
			return;
		}
		if (command === "linkedEditing") {
			try {
				await this.contributions.startLinked();
			} catch (error) {
				this.host.announce(String(error));
			}
			return;
		}
		this.inlineSuggestions.clear();
		this.abort.abort();
		this.abort = new AbortController();
		try {
			const context = {
					...this.context(this.abort.signal),
					trigger: trigger ?? { kind: "invoke" as const },
				},
				version = context.model.getVersionId();
			if (command === "rename") {
				this.rename(context, version);
				return;
			}
			if (command === "inline") {
				let result = await this.request<
					readonly InlineCompletion[] | InlineCompletionList
				>("inlineCompletions", context);
				if (
					!hasLanguageProvider(context.model, "inlineCompletions") &&
					!("items" in result) &&
					!result.length
				) {
					const { prefix, ordered } = prepareCompletions(
						context,
						await this.request<
							readonly Completion[] | CompletionList
						>("complete", context),
					);
					result = ordered
						.filter(
							(item) =>
								!item.snippet &&
								!item.source &&
								!item.additionalEdits?.length &&
								item.insertText.startsWith(prefix),
						)
						.map((item) => ({
							from: item.from,
							to: item.to,
							insertText: item.insertText,
						}));
				}
				this.inlineSuggestions.show(context, version, result);
				return;
			}
			if (command === "complete") {
				const { ordered, incomplete } = prepareCompletions(
					context,
					await this.request<readonly Completion[] | CompletionList>(
						"complete",
						context,
					),
				);
				if (
					!this.valid(context, version) ||
					!this.caretAt(context.offset)
				)
					return;
				this.completionIncomplete = incomplete;
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
				this.completionIncomplete = incomplete;
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
				const result = await this.request<
					string | SignatureHelp | null
				>("signature", context);
				if (
					this.valid(context, version) &&
					this.caretAt(context.offset) &&
					result
				)
					showSignatures(this.popup, result, context.offset);
				return;
			}
			const method = command.startsWith("peek")
				? command.slice(4, 5).toLowerCase() + command.slice(5)
				: command;
			if (
				[
					"definitions",
					"references",
					"declarations",
					"typeDefinitions",
					"implementations",
				].includes(method)
			) {
				await this.navigation.show(
					context,
					method,
					command.startsWith("peek"),
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
			if (["actions", "refactor", "organizeImports"].includes(command))
				await this.navigation.actions(
					context,
					command === "refactor"
						? "refactor"
						: command === "organizeImports"
							? "source.organizeImports"
							: undefined,
				);
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
	): Promise<{
		detail: string;
		edits: readonly LanguageEdit[];
		documentation?: Documentation;
	} | null> {
		const old = this.resolved.get(item);
		if (
			old?.model === context.model &&
			old.version === context.model.getVersionId()
		)
			return old.result;
		const version = context.model.getVersionId();
		const result = await this.request<{
			detail: string;
			edits: readonly LanguageEdit[];
			documentation?: Documentation;
		} | null>("resolveCompletion", context, {
			name: item.label,
			source: item.source,
			data: item.data,
			item,
		});
		if (
			result &&
			!context.signal.aborted &&
			context.model.getVersionId() === version
		)
			this.resolved.set(item, { model: context.model, version, result });
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
					!this.valid(context, version) ||
					this.widget.hidden ||
					this.completions[this.index] !== item
				)
					return;
				let detail = this.widget.querySelector<HTMLDivElement>(
					".editor-completion-detail",
				);
				if (!detail) {
					detail = this.widget.ownerDocument.createElement("div");
					detail.className = "editor-completion-detail";
					this.widget.append(detail);
				}
				detail.replaceChildren(
					renderDocumentation(
						detail.ownerDocument,
						result?.documentation ??
							item.documentation ??
							result?.detail ??
							item.detail ??
							"",
						(target) => this.host.openLink(target),
					),
				);
			})
			.catch(() => {});
	}

	private showHover(offset: number, result: Hover | null): void {
		const diagnostics = this.host
			.diagnostics()
			.filter((item) => offset >= item.from && offset <= item.to)
			.map((item) => item.message);
		const text = [...diagnostics, result?.text]
			.filter(Boolean)
			.join("\n\n");
		if (text || result?.documentation) {
			const doc = this.widget.ownerDocument,
				content = doc.createElement("div");
			if (diagnostics.length)
				content.append(
					renderDocumentation(doc, diagnostics.join("\n\n")),
				);
			if (result?.documentation ?? result?.text)
				content.append(
					renderDocumentation(
						doc,
						result?.documentation ?? result?.text ?? "",
						(target) => this.host.openLink(target),
					),
				);
			this.popup.showContent("Hover", content, offset);
		}
	}
	private rename(context: LanguageContext, version: number): void {
		void showRename(
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
		).catch((error) => this.host.announce(String(error)));
	}
	private colorPicker(): void {
		this.abort.abort();
		this.abort = new AbortController();
		if (!this.host.model()) return;
		showColorPicker(
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
			this.context(this.abort.signal),
		);
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
				detail: `${item.severity} - ${item.source ?? model.getLanguageId()}`,
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
		if (
			this.popup.mode === "signature" &&
			event.altKey &&
			["ArrowUp", "ArrowDown"].includes(event.key)
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.widget
				.querySelectorAll<HTMLButtonElement>("button")
				[event.key === "ArrowDown" ? 1 : 0]?.click();
			return;
		}
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
		if (event.key === "Escape" && this.contributions.endLinked()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (event.key === "Escape") this.host.cancelSnippet();
		if (
			event.key === "Escape" &&
			(!this.widget.hidden || this.inlineSuggestions.active)
		) {
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
				this.popup.updatePreview();
				this.host.input.setAttribute(
					"aria-activedescendant",
					`${this.widget.id}-${this.index}`,
				);
			}
			return;
		}
		if (
			this.inlineSuggestions.active &&
			(event.key === "Tab" ||
				(event.ctrlKey && event.key === "ArrowRight"))
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.inlineSuggestions.accept(event.key !== "Tab");
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
	private readonly compositionStart = (): void => {
		this.cancelRequests();
	};
	private readonly compositionEnd = (): void => {
		if (!this.disposed) this.changed();
	};
	private readonly beforeInput = (event: InputEvent): void => {
		if (
			event.isComposing ||
			!this.host.canEdit() ||
			this.host.performance().mode === "reduced"
		)
			return;
		if (event.inputType === "insertText" && event.data)
			this.contributions.beforeInput(event.data);
		if (
			!["insertText", "insertLineBreak", "insertParagraph"].includes(
				event.inputType,
			)
		)
			return;
		const model = this.host.model();
		if (!model) return;
		const version = model.getVersionId(),
			data = event.data,
			incomplete = this.completionIncomplete;
		if (this.triggerTimer) clearTimeout(this.triggerTimer);
		this.triggerTimer = setTimeout(() => {
			if (
				this.disposed ||
				!this.host.canEdit() ||
				this.host.model() !== model ||
				model.getVersionId() <= version
			)
				return;
			this.contributions.onType(data ?? "\n");
			if (
				data &&
				(data === "(" ||
					data === "," ||
					languageProviders(model.getLanguageId()).some((provider) =>
						provider.signatureTriggerCharacters?.includes(data),
					))
			)
				void this.run("signature", {
					kind: "character",
					character: data,
				});
			else if (
				data &&
				(incomplete ||
					data === "." ||
					languageProviders(model.getLanguageId()).some((provider) =>
						provider.completionTriggerCharacters?.includes(data),
					) ||
					isWord(
						getLanguageConfiguration(model.getLanguageId()),
						data,
					))
			)
				void this.run("complete", {
					kind: incomplete ? "incomplete" : "character",
					character: data,
				});
		}, 0);
	};
	private readonly pointerMove = (event: PointerEvent): void => {
		if (this.host.performance().mode === "reduced") return;
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
		if (completion !== undefined && !this.caretAt(completion)) {
			this.abort.abort();
			this.close();
		}
		this.inlineSuggestions.selectionChanged();
		this.contributions.selectionChanged();
	}
	expandSelection(shrink = false): boolean {
		if (!this.contributions.hasSelectionRanges()) return false;
		void this.contributions
			.expand(shrink)
			.catch((error) => this.host.announce(String(error)));
		return true;
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
		this.host.input.removeEventListener(
			"beforeinput",
			this.beforeInput,
			true,
		);
		this.host.input.removeEventListener(
			"compositionstart",
			this.compositionStart,
			true,
		);
		this.host.input.removeEventListener(
			"compositionend",
			this.compositionEnd,
		);
		this.host.viewport.removeEventListener("pointermove", this.pointerMove);
		this.host.viewport.removeEventListener(
			"pointerleave",
			this.pointerLeave,
		);
		this.widget.removeEventListener("keydown", this.keydown);

		this.contributions.dispose();
		this.inlineSuggestions.clear();
		this.popup.dispose();

		this.status.remove();
	}
}
