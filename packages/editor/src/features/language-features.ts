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
import { getLanguage, languageProviders } from "../api/languages";
import type { Disposable, TextSelection } from "../api/types";
import { languageEngine } from "../languages/client";
import type { TextModel } from "../model/text-model";

interface Host {
	readonly frame: HTMLElement;
	readonly input: HTMLTextAreaElement;
	readonly viewport: HTMLElement;
	model(): TextModel | null;
	selection(): TextSelection;
	canEdit(): boolean;
	diagnostics(): readonly Diagnostic[];
	analysisOptions(): { inlayHints: boolean; codeLens: boolean };
	point(offset: number): { x: number; y: number; height: number };
	offsetAtPoint(x: number, y: number): number;
	analysis(value: Analysis): void;
	apply(edits: readonly LanguageEdit[]): void;
	accept(item: Completion): void;
	snippet(body: string): void;
	nextSnippet(backward: boolean): boolean;
	cancelSnippet(): void;
	open(location: Location): void;
	announce(message: string): void;
}
interface Choice {
	label: string;
	detail?: string;
	run(): void;
}
export class LanguageFeatures implements Disposable {
	private readonly widget: HTMLDivElement;
	private readonly ghost: HTMLDivElement;
	private readonly status: HTMLButtonElement;
	private subscriptions: Disposable[] = [];
	private abort = new AbortController();
	private analysisAbort = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private choices: Choice[] = [];
	private completions: readonly Completion[] = [];
	private readonly resolved = new WeakMap<
		Completion,
		{ detail: string; edits: readonly LanguageEdit[] }
	>();
	private index = 0;

	private disposed = false;
	private lastAnalysis: Analysis = {
		tokens: [],
		diagnostics: [],
		folds: [],
		symbols: [],
	};
	private inline = "";
	private inlineVersion = 0;
	private anchorOffset = 0;
	private anchorModel: TextModel | null = null;
	private readonly resize: ResizeObserver;
	constructor(private readonly host: Host) {
		const doc = host.frame.ownerDocument;
		this.widget = doc.createElement("div");
		this.widget.className = "editor-language-widget";
		this.widget.hidden = true;
		this.widget.id = `language-${crypto.randomUUID()}`;
		this.widget.setAttribute("aria-label", "Language assistance");
		this.widget.tabIndex = -1;
		this.ghost = doc.createElement("div");
		this.ghost.className = "editor-inline-completion";
		this.ghost.hidden = true;
		this.ghost.setAttribute("aria-hidden", "true");
		this.status = doc.createElement("button");
		this.status.type = "button";
		this.status.className = "editor-language-status";
		this.status.textContent = "Checking…";
		this.status.title = "Show problems";
		this.resize = new ResizeObserver(() => this.reposition());
		this.resize.observe(host.frame);
		host.viewport.addEventListener("scroll", this.reposition, true);
		this.status.onclick = () => void this.run("problems");
		host.frame.append(this.widget, this.ghost, this.status);
		host.input.addEventListener("keydown", this.keydown, true);
		host.input.addEventListener("beforeinput", this.beforeInput);
		host.viewport.addEventListener("pointermove", this.pointerMove);
		host.viewport.addEventListener("pointerleave", this.pointerLeave);
		this.widget.addEventListener("keydown", this.keydown);
		this.widget.addEventListener("pointerdown", this.keepFocus);
	}
	setModel(model: TextModel | null): void {
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
		for (const provider of languageProviders(
			context.model.getLanguageId(),
		)) {
			let value: unknown;
			switch (method) {
				case "analyze":
					value = await provider.analyze?.(context);
					break;
				case "resolveCompletion":
					value = await provider.resolveCompletion?.(
						context,
						extra.item as Completion,
					);
					break;
				case "complete":
					value = await provider.complete?.(context);
					break;
				case "hover":
					value = await provider.hover?.(context);
					break;
				case "signature":
					value = await provider.signature?.(context);
					break;
				case "definitions":
					value = await provider.definitions?.(context);
					break;
				case "references":
					value = await provider.references?.(context);
					break;
				case "rename":
					value = await provider.rename?.(
						context,
						String(extra.name ?? ""),
					);
					break;
				case "format":
					value = await provider.format?.(
						context,
						extra.range as { from: number; to: number } | undefined,
					);
					break;
				case "actions":
					value = await provider.actions?.(context);
					break;
			}
			if (value !== undefined) return value as T;
		}
		return languageEngine.request<T>(
			method,
			context.model,
			context.offset,
			context.signal,
			extra,
		);
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
				const entries = [
						...(await this.request<readonly Completion[]>(
							"complete",
							context,
						)),
					],
					prefix =
						context.text
							.slice(0, context.offset)
							.match(/[\p{ID_Continue}$]*$/u)?.[0] ?? "";
				const snippets =
					getLanguage(context.model.getLanguageId())?.snippets ??
					(context.model.getLanguageId() === "typescript" ||
					context.model.getLanguageId() === "javascript"
						? [
								{
									label: "for",
									body: `for (let \${1:i} = 0; \${1:i} < \${2:count}; \${1:i}++) {\n\t$0\n}`,
								},
								{
									label: "function",
									body: `function \${1:name}(\${2:args}) {\n\t$0\n}`,
								},
								{
									label: "if",
									body: `if (\${1:condition}) {\n\t$0\n}`,
								},
							]
						: []);
				for (const snippet of snippets)
					entries.push({
						label: snippet.label,
						insertText: snippet.body,
						from: context.offset - prefix.length,
						to: context.offset,
						snippet: true,
						detail: "Snippet",
					});
				const ordered = entries
					.filter(
						(entry) =>
							!prefix ||
							entry.label
								.toLowerCase()
								.includes(prefix.toLowerCase()),
					)
					.sort(
						(a, b) =>
							Number(
								!a.label
									.toLowerCase()
									.startsWith(prefix.toLowerCase()),
							) -
								Number(
									!b.label
										.toLowerCase()
										.startsWith(prefix.toLowerCase()),
								) ||
							(a.sort ?? a.label).localeCompare(
								b.sort ?? b.label,
							),
					);
				if (!this.valid(context, version)) return;
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
					this.position(this.ghost, context.offset);
					this.ghost.textContent = this.inline;
					this.ghost.hidden = false;
					return;
				}
				this.completions = ordered.slice(0, 100);
				this.showChoices(
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
					this.showText("Signature help", result, context.offset);
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
				this.showChoices(
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
				if (this.valid(context, version)) this.host.apply(result);
				return;
			}
			if (command === "actions") {
				const result = await this.request<readonly CodeAction[]>(
					"actions",
					context,
				);
				if (!this.valid(context, version)) return;
				this.showChoices(
					"actions",
					result.map((action) => ({
						label: action.title,
						run: () => {
							if (
								this.valid(context, version) &&
								this.host.canEdit()
							)
								this.host.apply(action.edits);
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
	): Promise<void> {
		try {
			const result = await this.resolveItem(item, context);
			if (this.valid(context, version) && this.host.canEdit())
				this.host.accept({
					...item,
					...(result?.edits.length
						? { additionalEdits: result.edits }
						: {}),
				});
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError"))
				this.host.announce(String(error));
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
		if (text) this.showText("Hover", text, offset);
	}
	private rename(context: LanguageContext, version: number): void {
		this.close();
		const form = this.widget.ownerDocument.createElement("form"),
			label = this.widget.ownerDocument.createElement("label"),
			field = this.widget.ownerDocument.createElement("input");
		label.textContent = "New symbol name";
		field.setAttribute("aria-label", "New symbol name");
		field.value =
			(context.text
				.slice(0, context.offset)
				.match(/[\p{ID_Continue}$]+$/u)?.[0] ?? "") +
			(context.text
				.slice(context.offset)
				.match(/^[\p{ID_Continue}$]+/u)?.[0] ?? "");
		label.append(field);
		form.append(label);
		form.onsubmit = (event) => {
			event.preventDefault();
			if (!/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(field.value)) {
				this.host.announce("Enter a valid identifier.");
				return;
			}
			void this.request<readonly LanguageEdit[]>("rename", context, {
				name: field.value,
			})
				.then((edits) => {
					if (this.valid(context, version) && this.host.canEdit()) {
						this.close();
						this.host.apply(edits);
						this.host.input.focus({ preventScroll: true });
					}
				})
				.catch((error) => this.host.announce(String(error)));
		};
		this.widget.replaceChildren(form);
		this.widget.hidden = false;
		this.position(this.widget, context.offset);
		field.focus();
		field.select();
	}
	private colorPicker(): void {
		const model = this.host.model(),
			offset = this.host.selection().end,
			color = this.lastAnalysis.colors?.find(
				(color) => offset >= color.from && offset <= color.to,
			);
		if (!model || !color) {
			this.host.announce("No document color at the cursor.");
			return;
		}
		const version = model.getVersionId(),
			field = this.widget.ownerDocument.createElement("input"),
			button = this.widget.ownerDocument.createElement("button");
		field.type = "color";
		field.value = color.color.slice(0, 7);
		field.setAttribute("aria-label", "Color value");
		button.type = "button";
		button.textContent = "Apply color";
		button.onclick = () => {
			if (
				this.host.model() === model &&
				model.getVersionId() === version &&
				this.host.canEdit()
			) {
				const original = model
						.getValue({ eol: "\n" })
						.slice(color.from, color.to),
					hex = field.value + color.color.slice(7),
					text = original.startsWith('"') ? JSON.stringify(hex) : hex;
				this.host.apply([
					{
						uri: model.uri.toString(),
						from: color.from,
						to: color.to,
						text,
						version,
					},
				]);
				this.close();
				this.host.input.focus({ preventScroll: true });
			}
		};
		this.widget.replaceChildren(field, button);
		this.widget.hidden = false;
		this.position(this.widget, color.from);
		field.focus();
	}
	private readonly reposition = (): void => {
		if (this.disposed) return;
		if (this.host.model() !== this.anchorModel) {
			this.close();
			return;
		}
		const point = this.host.point(this.anchorOffset),
			bounds = this.host.viewport.getBoundingClientRect();
		if (point.y < bounds.top || point.y > bounds.bottom) {
			this.close();
			return;
		}
		if (!this.widget.hidden) this.position(this.widget, this.anchorOffset);
		if (!this.ghost.hidden) this.position(this.ghost, this.anchorOffset);
	};

	offerSnippetChoices(choices: readonly string[]): void {
		const selection = this.host.selection();
		this.showChoices(
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
		this.showChoices(
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
		this.showChoices(
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
		const definition = getLanguage(
				this.host.model()?.getLanguageId() ?? "",
			),
			snippets = definition?.snippets ?? [
				{
					label: "For loop",
					body: `for (let \${1:i} = 0; \${1:i} < \${2:count}; \${1:i}++) {\n\t$0\n}`,
				},
				{
					label: "Function",
					body: `function \${1:name}(\${2:args}) {\n\t$0\n}`,
				},
				{
					label: "Try/catch",
					body: `try {\n\t$0\n} catch (\${1:error}) {\n\tconsole.error(\${1:error});\n}`,
				},
			];
		this.showChoices(
			"snippets",
			snippets.map((snippet) => ({
				label: snippet.label,
				run: () => this.host.snippet(snippet.body),
			})),
			this.host.selection().end,
			true,
		);
	}
	peek(location: Location): void {
		this.showText(
			location.label ?? "Definition",
			location.preview ?? location.uri,
			this.host.selection().end,
		);
	}
	private showText(title: string, text: string, offset: number): void {
		this.choices = [];
		const heading = this.widget.ownerDocument.createElement("strong"),
			pre = this.widget.ownerDocument.createElement("pre");
		heading.textContent = title;
		pre.textContent = text;
		this.widget.replaceChildren(heading, pre);
		this.widget.setAttribute("role", "tooltip");
		this.widget.hidden = false;
		this.position(this.widget, offset);
	}
	private showChoices(
		mode: string,
		choices: Choice[],
		offset: number,
		filter = false,
	): void {
		this.close(false);
		if (!choices.length) {
			if (mode !== "complete") this.host.announce("No results.");
			return;
		}
		this.choices = choices;
		this.index = 0;
		this.widget.setAttribute("role", "listbox");
		this.widget.hidden = false;
		const list = this.widget.ownerDocument.createElement("div");
		list.className = "editor-language-list";
		const render = () => {
			const fragment = list.ownerDocument.createDocumentFragment();
			for (let index = 0; index < this.choices.length; index++) {
				const choice = this.choices[index];
				if (!choice) continue;
				const option = list.ownerDocument.createElement("button");
				option.type = "button";
				option.id = `${this.widget.id}-${index}`;
				option.setAttribute("role", "option");
				option.setAttribute(
					"aria-selected",
					String(index === this.index),
				);
				option.textContent = choice.label;
				const detail = list.ownerDocument.createElement("small");
				detail.textContent = choice.detail ?? "";
				option.append(detail);
				option.onclick = () => this.acceptChoice(index);
				fragment.append(option);
			}
			list.replaceChildren(fragment);
			this.host.input.setAttribute(
				"aria-activedescendant",
				`${this.widget.id}-${this.index}`,
			);
		};
		this.widget.replaceChildren();
		if (filter) {
			const input = this.widget.ownerDocument.createElement("input");
			input.setAttribute("aria-label", "Filter results");
			input.placeholder = "Filter results";
			input.oninput = () => {
				this.choices = choices.filter((choice) =>
					choice.label
						.toLowerCase()
						.includes(input.value.toLowerCase()),
				);
				this.index = 0;
				render();
			};
			this.widget.append(input);
			queueMicrotask(() => input.focus());
		}
		this.widget.append(list);
		render();
		this.host.input.setAttribute("aria-controls", this.widget.id);
		this.host.input.setAttribute("aria-expanded", "true");
		this.host.input.setAttribute("aria-autocomplete", "list");
		this.position(this.widget, offset);
	}
	private acceptChoice(index: number): void {
		const choice = this.choices[index];
		this.close();
		choice?.run();
		this.host.input.focus({ preventScroll: true });
	}
	private position(element: HTMLElement, offset: number): void {
		this.anchorOffset = offset;
		this.anchorModel = this.host.model();
		const point = this.host.point(offset),
			bounds = this.host.frame.getBoundingClientRect();
		if (element === this.ghost) {
			element.style.left = `${point.x - bounds.left}px`;
			element.style.top = `${point.y - bounds.top}px`;
			return;
		}
		element.style.left = `${Math.max(8, Math.min(point.x - bounds.left, bounds.width - 360))}px`;
		element.style.top = `${Math.max(8, Math.min(point.y + point.height - bounds.top, bounds.height - 180))}px`;
	}
	private readonly keepFocus = (event: PointerEvent): void => {
		if (event.target instanceof Element && event.target.closest("button"))
			event.preventDefault();
	};
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.isComposing) return;
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
				this.acceptChoice(this.index);
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
			this.ghost.textContent = remaining;
			this.ghost.hidden = !remaining;
			if (remaining) this.position(this.ghost, this.host.selection().end);
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
				else if (data === "." || /[\p{ID_Continue}$]/u.test(data))
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
		this.widget.hidden = true;
		this.widget.replaceChildren();
		this.choices = [];
		this.completions = [];
		this.host.input.removeAttribute("aria-activedescendant");
		this.host.input.setAttribute("aria-expanded", "false");
		if (clearInline) {
			this.inline = "";
			this.ghost.hidden = true;
		}
	}
	dispose(): void {
		this.disposed = true;
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
		this.widget.removeEventListener("pointerdown", this.keepFocus);
		this.resize.disconnect();
		this.host.viewport.removeEventListener("scroll", this.reposition, true);
		this.widget.remove();
		this.ghost.remove();
		this.status.remove();
	}
}
