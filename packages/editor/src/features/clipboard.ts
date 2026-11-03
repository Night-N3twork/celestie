import type { Disposable, TextSelection } from "../api/types";
import type { LanguageConfiguration } from "../languages/configuration";
import { normalizeInputText } from "../view/input";
import { BracketAnalysis } from "./bracket-analysis";
import type { EditingPlan } from "./editing-plan";
import { planLineCommand } from "./line-commands";
import {
	combineLinePlans,
	combinePlans,
	caret as makeCaret,
	replacementPlan,
} from "./selections";

export interface TransferContext {
	readonly text: string;
	readonly documentText: string;
	readonly selection: TextSelection;
	readonly types: readonly string[];
	readonly files: readonly File[];
}
export type TransferProvider = (context: TransferContext) => string | undefined;

interface ClipboardHost {
	consumeChord(key: string): boolean;
	getText(): string;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	isReadOnly(): boolean;
	isComposing(): boolean;
	apply(plan: EditingPlan): void;
	focus(): void;
	announce(message: string): void;
	offsetAtPoint(x: number, y: number): number;
	getTabSize(): number;
}

const selectionsMime = "application/x-celestie-editor-selections";
function readSelectionParts(
	value: string,
	html = false,
): readonly string[] | undefined {
	try {
		const encoded = html
			? value.match(/data-celestie-selections="([^"]*)"/)?.[1]
			: value;
		if (!encoded) return undefined;
		const result: unknown = JSON.parse(
			html ? decodeURIComponent(encoded) : encoded,
		);
		return Array.isArray(result) &&
			result.length <= 1000 &&
			result.every((value) => typeof value === "string")
			? result.map((value) => normalizeInputText(value))
			: undefined;
	} catch {
		return undefined;
	}
}
const wholeLineMime = "application/x-celestie-editor-line";
const escapeHtml = (text: string): string =>
	text.replace(
		/[&<>"']/g,
		(unit) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[unit] ?? unit,
	);

export function richCopyHtml(
	text: string,
	language: LanguageConfiguration,
	tabSize: number,
): string {
	const analysis = new BracketAnalysis(text, language);
	let html = "";
	for (const match of text.matchAll(
		/[\p{ID_Continue}$]+|\s+|[^\p{ID_Continue}$\s]+/gu,
	)) {
		const context = analysis.contextAt(match.index + 1);
		const color = context.includes("comment")
			? "#6a9955"
			: context === "string" || context === "template"
				? "#ce9178"
				: context === "regex"
					? "#d16969"
					: /^(const|let|var|function|return|if|else|class|interface|type|import|export|from|new|async|await|true|false|null|undefined|throw|try|catch|for|while|switch|case|break|extends|implements|public|private|readonly|number|string|boolean|void)$/.test(
								match[0],
							)
						? "#569cd6"
						: /^\d/.test(match[0])
							? "#b5cea8"
							: "";
		html += color
			? `<span style="color:${color}">${escapeHtml(match[0])}</span>`
			: escapeHtml(match[0]);
	}
	return `<pre style="white-space:pre;tab-size:${tabSize};font-family:monospace;background:#1e1e1e;color:#d4d4d4">${html}</pre>`;
}

export class EditorClipboard implements Disposable {
	private readonly pasteProviders: TransferProvider[] = [];
	private readonly dropProviders: TransferProvider[] = [];
	private drag:
		| { text: string; selection: TextSelection; handled: boolean }
		| undefined;
	private disposed = false;

	constructor(
		private readonly input: HTMLTextAreaElement,
		private readonly host: ClipboardHost,
		private language: LanguageConfiguration,
	) {
		input.addEventListener("copy", this.copyEvent);
		input.addEventListener("cut", this.cutEvent);
		input.addEventListener("paste", this.pasteEvent);
		input.addEventListener("dragstart", this.dragStart);
		input.addEventListener("dragend", this.dragEnd);
		input.addEventListener("dragover", this.dragOver);
		input.addEventListener("drop", this.drop);
		input.addEventListener("beforeinput", this.beforeInput);
	}

	setLanguageConfiguration(language: LanguageConfiguration): void {
		this.language = language;
	}

	registerPasteProvider(provider: TransferProvider): Disposable {
		return this.register(this.pasteProviders, provider);
	}
	registerDropProvider(provider: TransferProvider): Disposable {
		return this.register(this.dropProviders, provider);
	}
	private register(
		list: TransferProvider[],
		provider: TransferProvider,
	): Disposable {
		if (this.disposed) throw new Error("Clipboard disposed.");
		list.push(provider);
		return {
			dispose: () => {
				const index = list.indexOf(provider);
				if (index !== -1) list.splice(index, 1);
			},
		};
	}

	private writable(): boolean {
		if (this.disposed) return false;
		if (this.host.isReadOnly() || this.host.isComposing()) {
			this.host.announce(
				this.host.isReadOnly()
					? "Editor is read-only."
					: "Finish composing text before using this command.",
			);
			return false;
		}
		return true;
	}

	private copyPayload() {
		const text = this.host.getText();
		const selection = this.host.getSelection();
		const wholeLine = selection.start === selection.end;
		const from = wholeLine
			? selection.start === 0
				? 0
				: text.lastIndexOf("\n", selection.start - 1) + 1
			: selection.start;
		const newline = text.indexOf("\n", from);
		const to = wholeLine
			? newline === -1
				? text.length
				: newline + 1
			: selection.end;
		const selections = this.host.getSelections();
		const allWholeLine = selections.every(
			(value) => value.start === value.end,
		);
		const pieces = selections
			.slice()
			.sort((a, b) => a.start - b.start)
			.map((value) => {
				if (!allWholeLine) return text.slice(value.start, value.end);
				const start =
					value.start === 0
						? 0
						: text.lastIndexOf("\n", value.start - 1) + 1;
				const finish = text.indexOf("\n", start);
				return {
					start,
					text:
						text.slice(start, finish < 0 ? text.length : finish) +
						"\n",
				};
			});
		const plain =
			selections.length > 1
				? allWholeLine
					? [
							...new Map(
								pieces.map((piece) =>
									typeof piece === "string"
										? [0, piece]
										: [piece.start, piece.text],
								),
							).values(),
						].join("")
					: pieces.join("\n")
				: text.slice(from, to) +
					(wholeLine && newline === -1 ? "\n" : "");
		const parts =
			selections.length > 1
				? pieces.map((piece) =>
						typeof piece === "string" ? piece : piece.text,
					)
				: undefined;
		return {
			plain,
			parts,
			html: richCopyHtml(
				plain,
				this.language,
				this.host.getTabSize(),
			).replace(
				"<pre",
				`<pre${allWholeLine ? ' data-celestie-whole-line="true"' : ""}${parts ? ` data-celestie-selections="${encodeURIComponent(JSON.stringify(parts))}"` : ""}`,
			),
			wholeLine: allWholeLine,
			selections,
			document: text,
			selection,
		};
	}

	private sameDocument(text: string, selection: TextSelection): boolean {
		const now = this.host.getSelection();
		return (
			!this.disposed &&
			text === this.host.getText() &&
			now.start === selection.start &&
			now.end === selection.end &&
			now.direction === selection.direction
		);
	}

	private cut(payload: ReturnType<EditorClipboard["copyPayload"]>): boolean {
		if (
			!this.writable() ||
			!this.sameDocument(payload.document, payload.selection)
		)
			return false;
		if (payload.selections.length > 1) {
			if (
				JSON.stringify(payload.selections) !==
				JSON.stringify(this.host.getSelections())
			)
				return false;
			const plan = payload.wholeLine
				? combineLinePlans(
						payload.document,
						payload.selections,
						(selection, includeEndLine) =>
							planLineCommand(
								payload.document,
								selection,
								"delete",
								undefined,
								includeEndLine,
							),
						"collapse",
					)
				: combinePlans(
						payload.selections.map((selection) =>
							replacementPlan(selection, ""),
						),
						payload.document.length,
					);
			this.host.apply(plan);
			return true;
		}
		const plan = payload.wholeLine
			? planLineCommand(payload.document, payload.selection, "delete")
			: {
					edits: [
						{
							from: payload.selection.start,
							to: payload.selection.end,
							text: "",
						},
					],
					selection: {
						start: payload.selection.start,
						end: payload.selection.start,
						direction: "none" as const,
					},
				};
		if (plan) this.host.apply(plan);
		return !!plan;
	}

	private readonly copyEvent = (event: ClipboardEvent): void =>
		this.writeEvent(event, false);
	private readonly cutEvent = (event: ClipboardEvent): void =>
		this.writeEvent(event, true);
	private writeEvent(event: ClipboardEvent, cut: boolean): void {
		if (this.host.consumeChord(cut ? "x" : "c")) {
			event.preventDefault();
			return;
		}
		if (!event.clipboardData) return;
		event.preventDefault();
		if (cut && !this.writable()) return;
		const payload = this.copyPayload();
		event.clipboardData.setData("text/plain", payload.plain);
		event.clipboardData.setData("text/html", payload.html);
		if (payload.parts)
			event.clipboardData.setData(
				selectionsMime,
				JSON.stringify(payload.parts),
			);
		if (payload.wholeLine)
			event.clipboardData.setData(wholeLineMime, "true");
		if (cut) this.cut(payload);
	}

	async copy(cut = false): Promise<void> {
		if (this.disposed) throw new Error("Clipboard disposed.");
		if (cut && !this.writable()) return;
		const payload = this.copyPayload();
		const clipboard =
			this.input.ownerDocument.defaultView?.navigator.clipboard;
		if (!clipboard)
			throw new Error(
				"Clipboard access is unavailable. Use Ctrl/Cmd+C or X.",
			);
		if (typeof ClipboardItem !== "undefined" && clipboard.write)
			await clipboard.write([
				new ClipboardItem({
					"text/plain": new Blob([payload.plain], {
						type: "text/plain",
					}),
					"text/html": new Blob([payload.html], {
						type: "text/html",
					}),
				}),
			]);
		else await clipboard.writeText(payload.plain);
		this.host.announce(
			cut
				? this.cut(payload)
					? "Text cut."
					: "Text copied; cut canceled because the document or selection changed."
				: "Text copied.",
		);
	}

	async paste(): Promise<void> {
		if (!this.writable()) return;
		const original = this.host.getText();
		const selection = this.host.getSelection();
		const selectionKey = JSON.stringify(this.host.getSelections());
		const clipboard =
			this.input.ownerDocument.defaultView?.navigator.clipboard;
		if (!clipboard)
			throw new Error("Clipboard access is unavailable. Use Ctrl/Cmd+V.");
		let text = "";
		let wholeLine = false;
		let parts: readonly string[] | undefined;
		if (clipboard.read) {
			const items = await clipboard.read();
			const item = items.find((item) =>
				item.types.includes("text/plain"),
			);
			if (item) {
				text = await (await item.getType("text/plain")).text();
				if (item.types.includes("text/html")) {
					const html = await (await item.getType("text/html")).text();
					wholeLine = html.includes(
						'data-celestie-whole-line="true"',
					);
					parts = readSelectionParts(html, true);
				}
			}
		} else text = await clipboard.readText();
		if (
			!this.sameDocument(original, selection) ||
			selectionKey !== JSON.stringify(this.host.getSelections()) ||
			!this.writable()
		) {
			this.host.announce(
				"Document or selection changed; paste canceled.",
			);
			return;
		}
		this.insert(
			text,
			["text/plain"],
			[],
			wholeLine,
			this.pasteProviders,
			parts,
		);
	}

	private readonly pasteEvent = (event: ClipboardEvent): void => {
		if (!event.clipboardData) return;
		event.preventDefault();
		if (!this.writable()) return;
		this.insert(
			event.clipboardData.getData("text/plain"),
			[...event.clipboardData.types],
			[...event.clipboardData.files],
			event.clipboardData.getData(wholeLineMime) === "true" ||
				event.clipboardData
					.getData("text/html")
					.includes('data-celestie-whole-line="true"'),
			this.pasteProviders,
			readSelectionParts(event.clipboardData.getData(selectionsMime)) ??
				readSelectionParts(
					event.clipboardData.getData("text/html"),
					true,
				),
		);
	};

	private provided(
		text: string,
		types: readonly string[],
		files: readonly File[],
		selection: TextSelection,
		providers: readonly TransferProvider[],
	): string | undefined {
		try {
			for (const provider of [...providers].reverse()) {
				const result = provider({
					text,
					documentText: this.host.getText(),
					selection,
					types,
					files,
				});
				if (result !== undefined) {
					if (typeof result !== "string")
						throw new TypeError(
							"Paste/drop providers must return text or undefined.",
						);
					return normalizeInputText(result);
				}
			}
			if (files.length) {
				this.host.announce(
					"A drop or paste provider is required to insert files.",
				);
				return undefined;
			}
			return text ? normalizeInputText(text) : undefined;
		} catch (error) {
			this.host.announce(
				error instanceof Error
					? error.message
					: "Paste/drop provider failed.",
			);
			return undefined;
		}
	}

	private insert(
		text: string,
		types: readonly string[],
		files: readonly File[],
		wholeLine: boolean,
		providers: readonly TransferProvider[],
		parts?: readonly string[],
	): void {
		const selection = this.host.getSelection();
		const original = this.host.getText();
		const selectionKey = JSON.stringify(this.host.getSelections());
		const value = this.provided(text, types, files, selection, providers);
		if (
			value === undefined ||
			selectionKey !== JSON.stringify(this.host.getSelections()) ||
			!this.sameDocument(original, selection) ||
			!this.writable()
		)
			return;
		const selections = this.host.getSelections();
		if (selections.length > 1) {
			const lines = value.split("\n");
			const ordered = selections
				.slice()
				.sort((a, b) => a.start - b.start);
			const chunks =
				parts?.length === selections.length &&
				value === normalizeInputText(text)
					? parts
					: lines;
			const distribute = chunks.length === selections.length;
			const plans = selections.map((selection) => {
				const insert = distribute
					? (chunks[ordered.indexOf(selection)] ?? "")
					: value;
				if (wholeLine && selection.start === selection.end) {
					const start =
						selection.start === 0
							? 0
							: original.lastIndexOf("\n", selection.start - 1) +
								1;
					return {
						edits: [{ from: start, to: start, text: insert }],
						selection: makeCaret(selection.start + insert.length),
					};
				}
				return replacementPlan(selection, insert);
			});
			this.host.apply(combinePlans(plans, original.length));
			return;
		}
		const from =
			wholeLine && selection.start === selection.end
				? selection.start === 0
					? 0
					: original.lastIndexOf("\n", selection.start - 1) + 1
				: selection.start;
		const to =
			wholeLine && selection.start === selection.end
				? from
				: selection.end;
		const caret =
			wholeLine && selection.start === selection.end
				? selection.start + value.length
				: from + value.length;
		this.host.apply({
			edits: [{ from, to, text: value }],
			selection: { start: caret, end: caret, direction: "none" },
		});
	}

	private readonly dragStart = (event: DragEvent): void => {
		const selection = this.host.getSelection();
		if (!event.dataTransfer || selection.start === selection.end) return;
		this.drag = { text: this.host.getText(), selection, handled: false };
		const plain = this.host.getText().slice(selection.start, selection.end);
		event.dataTransfer.setData("text/plain", plain);
		event.dataTransfer.setData(
			"text/html",
			richCopyHtml(plain, this.language, this.host.getTabSize()),
		);
		event.dataTransfer.effectAllowed = this.host.isReadOnly()
			? "copy"
			: "copyMove";
	};
	private readonly dragEnd = (): void => {
		this.drag = undefined;
	};
	private readonly beforeInput = (event: InputEvent): void => {
		if (this.drag && event.inputType === "deleteByDrag" && event.cancelable)
			event.preventDefault();
	};
	private readonly dragOver = (event: DragEvent): void => {
		if (!event.dataTransfer) return;
		if (
			[...event.dataTransfer.types].some(
				(type) => type === "text/plain" || type === "Files",
			)
		) {
			event.preventDefault();
			event.dataTransfer.dropEffect = this.host.isReadOnly()
				? "none"
				: this.drag && !event.ctrlKey && !event.metaKey
					? "move"
					: "copy";
		}
	};
	private readonly drop = (event: DragEvent): void => {
		if (!event.dataTransfer) return;
		event.preventDefault();
		if (!this.writable()) return;
		const original = this.host.getText();
		const target = this.host.offsetAtPoint(event.clientX, event.clientY);
		const selection: TextSelection = {
			start: target,
			end: target,
			direction: "none",
		};
		const value = this.provided(
			event.dataTransfer.getData("text/plain"),
			[...event.dataTransfer.types],
			[...event.dataTransfer.files],
			selection,
			this.dropProviders,
		);
		if (
			value === undefined ||
			original !== this.host.getText() ||
			!this.writable()
		)
			return;
		const drag = this.drag;
		if (drag) drag.handled = true;
		const move =
			drag && drag.text === original && !event.ctrlKey && !event.metaKey;
		if (
			move &&
			target >= drag.selection.start &&
			target <= drag.selection.end
		)
			return;
		const edits = [{ from: target, to: target, text: value }];
		let caret = target + value.length;
		if (move) {
			edits.push({
				from: drag.selection.start,
				to: drag.selection.end,
				text: "",
			});
			if (target > drag.selection.end)
				caret -= drag.selection.end - drag.selection.start;
		}
		edits.sort((a, b) => a.from - b.from);
		this.host.apply({
			edits,
			selection: { start: caret, end: caret, direction: "none" },
		});
		this.host.focus();
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.input.removeEventListener("copy", this.copyEvent);
		this.input.removeEventListener("cut", this.cutEvent);
		this.input.removeEventListener("paste", this.pasteEvent);
		this.input.removeEventListener("dragstart", this.dragStart);
		this.input.removeEventListener("dragend", this.dragEnd);
		this.input.removeEventListener("dragover", this.dragOver);
		this.input.removeEventListener("drop", this.drop);
		this.input.removeEventListener("beforeinput", this.beforeInput);
		this.pasteProviders.length = 0;
		this.dropProviders.length = 0;
		this.drag = undefined;
	}
}
