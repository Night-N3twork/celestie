import { createSignal, onCleanup } from "solid-js";
import type {
	CodeAction,
	Command,
	CompletionItem,
	CompletionList,
	Hover,
	Location,
	LocationLink,
	SignatureHelp,
	TextEdit,
	WorkspaceEdit,
} from "vscode-languageserver-protocol";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import { offsets, positionAt } from "./lsp";
import { prepareWorkspaceEdit } from "./workspaceEdit";

export function createLanguageTools(c: WorkbenchController) {
	const [title, setTitle] = createSignal("");
	const [message, setMessage] = createSignal("");
	const [items, setItems] = createSignal<
		{ label: string; detail?: string; run: () => Promise<void> }[]
	>([]);
	const [rename, setRename] = createSignal(false);
	const [preview, setPreview] =
		createSignal<Awaited<ReturnType<typeof prepareWorkspaceEdit>>>();
	let generation = 0;
	let origin: { id: string; text: string; offset: number } | undefined;
	const close = () => {
		generation++;
		setTitle("");
		setPreview(undefined);
		setRename(false);
		c.setEditorFocus((value) => value + 1);
	};
	const plain = (value: unknown): string => {
		if (typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(plain).join("\n\n");
		if (value && typeof value === "object" && "value" in value)
			return String(value.value);
		return "";
	};
	const begin = (name: string) => {
		const doc = c.file();
		if (!doc || !c.language.host)
			throw new Error(
				"Language features require a supported file in a desktop workspace.",
			);
		origin = {
			id: doc.id,
			text: doc.editor.snapshot.text,
			offset: doc.editor.selection.head,
		};
		setTitle(name);
		setMessage("Loading…");
		setItems([]);
		setPreview(undefined);
		setRename(false);
		return {
			...origin,
			token: ++generation,
			position: positionAt(origin.text, origin.offset),
		};
	};
	const showEdit = async (edit: WorkspaceEdit) => {
		if (
			origin &&
			c.documents().find((doc) => doc.id === origin?.id)?.editor.snapshot
				.text !== origin.text
		)
			throw new Error("Document changed. Request the edit again.");
		const prepared = await prepareWorkspaceEdit(c, edit);
		setPreview(prepared);
		setItems([]);
		setRename(false);
		setMessage(
			prepared.plan.length
				? "Review changes, then apply them to your editor buffers."
				: "No changes.",
		);
	};
	async function request<T>(
		id: string,
		method: string,
		params?: Record<string, unknown>,
	): Promise<T> {
		await c.language.synchronize();
		const host = c.language.host;
		if (!host) throw new Error("Language service is unavailable.");
		return host.request<T>(id, method, params);
	}
	const suggest = async () => {
		const current = begin("Suggestions");
		const result = await request<CompletionItem[] | CompletionList | null>(
			current.id,
			"textDocument/completion",
			{ position: current.position, context: { triggerKind: 1 } },
		);
		if (current.token !== generation) return;
		const prefix =
			/[\w$]*$/.exec(current.text.slice(0, current.offset))?.[0] ?? "";
		const values = Array.isArray(result) ? result : (result?.items ?? []);
		setItems(
			values
				.filter((item) =>
					item.label.toLowerCase().startsWith(prefix.toLowerCase()),
				)
				.slice(0, 200)
				.map((item) => ({
					label: item.label,
					detail: item.detail,
					run: async () => {
						let resolved = item;
						try {
							resolved = await request<CompletionItem>(
								current.id,
								"completionItem/resolve",
								item as unknown as Record<string, unknown>,
							);
						} catch {}
						const textEdit = resolved.textEdit;
						const range = textEdit
							? "range" in textEdit
								? textEdit.range
								: textEdit.replace
							: {
									start: positionAt(
										current.text,
										current.offset - prefix.length,
									),
									end: current.position,
								};
						let newText =
							textEdit?.newText ??
							resolved.insertText ??
							item.label;
						if (resolved.insertTextFormat === 2)
							newText = newText
								.replace(/\$\{\d+:([^}]*)\}/g, "$1")
								.replace(/\$\d+|\$\{\d+\}/g, "");
						if (c.file()?.editor.snapshot.text !== current.text)
							throw new Error(
								"Document changed. Request completion again.",
							);
						const edits = [
							...(resolved.additionalTextEdits ?? []),
							{ range, newText },
						];
						const uriEdit: WorkspaceEdit = {
							changes: { [await documentUri(current.id)]: edits },
						};
						const prepared = await prepareWorkspaceEdit(c, uriEdit);
						await prepared.apply();
						const doc = c
							.documents()
							.find((doc) => doc.id === current.id);
						if (doc) {
							const start = offsets(current.text, range).from;
							const delta = (resolved.additionalTextEdits ?? [])
								.filter(
									(edit) =>
										offsets(current.text, edit.range).to <=
										start,
								)
								.reduce((sum, edit) => {
									const span = offsets(
										current.text,
										edit.range,
									);
									return (
										sum +
										edit.newText.length -
										(span.to - span.from)
									);
								}, 0);
							const cursor = start + delta + newText.length;
							doc.editor.setSelection({
								anchor: cursor,
								head: cursor,
							});
							c.changed();
						}
						close();
					},
				})),
		);
		setMessage(items().length ? "" : "No suggestions.");
	};
	async function documentUri(id: string): Promise<string> {
		return request<string>(id, "celestie/documentUri");
	}
	const information = async (signature: boolean) => {
		const current = begin(
			signature ? "Signature help" : "Hover information",
		);
		const result = signature
			? await request<SignatureHelp | null>(
					current.id,
					"textDocument/signatureHelp",
					{ position: current.position },
				)
			: await request<Hover | null>(current.id, "textDocument/hover", {
					position: current.position,
				});
		if (current.token !== generation) return;
		setMessage(
			result
				? "signatures" in result
					? result.signatures
							.map(
								(signature) =>
									`${signature.label}\n${plain(signature.documentation)}`,
							)
							.join("\n\n")
					: plain(result.contents)
				: "No information at this position.",
		);
	};
	const locations = async (references: boolean) => {
		const current = begin(references ? "References" : "Definitions");
		const result = await request<
			Location | (Location | LocationLink)[] | null
		>(
			current.id,
			references ? "textDocument/references" : "textDocument/definition",
			{
				position: current.position,
				...(references
					? { context: { includeDeclaration: true } }
					: {}),
			},
		);
		if (current.token !== generation) return;
		const locations = !result
			? []
			: Array.isArray(result)
				? result
				: [result];
		const choices = await Promise.all(
			locations.map(async (location) => {
				const uri =
					"uri" in location ? location.uri : location.targetUri;
				const range =
					"range" in location
						? location.range
						: location.targetSelectionRange;
				return {
					label: `${decodeURIComponent(uri.split("/").at(-1) ?? uri)}:${range.start.line + 1}:${range.start.character + 1}`,
					detail: decodeURIComponent(uri),
					run: async () => {
						const host = c.language.host;
						if (!host)
							throw new Error("Language service is unavailable.");
						const id = await host.fileId(uri);
						const text =
							c.documents().find((doc) => doc.id === id)?.editor
								.snapshot.text ??
							(await c.host.readTextFile(id)).text;
						const span = offsets(text, range);
						await c.navigateFile(id, {
							anchor: span.from,
							head: span.to,
						});
						close();
					},
				};
			}),
		);
		if (current.token !== generation) return;
		if (!references && choices.length === 1) {
			await choices[0].run();
			return;
		}
		setItems(choices);
		setMessage(choices.length ? "" : "No locations found.");
	};
	const startRename = () => {
		begin("Rename symbol");
		setMessage("");
		setRename(true);
	};
	const renameSymbol = async (name: string) => {
		if (!origin || !name.trim()) return;
		const result = await request<WorkspaceEdit | null>(
			origin.id,
			"textDocument/rename",
			{
				position: positionAt(origin.text, origin.offset),
				newName: name.trim(),
			},
		);
		if (!result) {
			setMessage("This symbol cannot be renamed.");
			return;
		}
		await showEdit(result);
	};
	const actions = async () => {
		const current = begin("Code actions");
		const result = await request<(CodeAction | Command)[] | null>(
			current.id,
			"textDocument/codeAction",
			{
				range: { start: current.position, end: current.position },
				context: { diagnostics: [] },
			},
		);
		if (current.token !== generation) return;
		setItems(
			(result ?? [])
				.filter(
					(action): action is CodeAction =>
						"edit" in action && !action.disabled && !!action.edit,
				)
				.map((action) => ({
					label: action.title,
					run: () => showEdit(action.edit ?? {}),
				})),
		);
		setMessage(
			items().length ? "" : "No editable code actions at this position.",
		);
	};
	const format = async () => {
		const current = begin("Format with language server");
		const edits = await request<TextEdit[] | null>(
			current.id,
			"textDocument/formatting",
			{
				options: {
					tabSize: c.settings().tabSize,
					insertSpaces: c.settings().insertSpaces,
				},
			},
		);
		if (current.token !== generation) return;
		await showEdit({
			changes: { [await documentUri(current.id)]: edits ?? [] },
		});
	};
	const execute = async (run: () => Promise<void> | void) => {
		try {
			await run();
		} catch (error) {
			setMessage(String(error));
		}
	};
	const commands = [
		["language.complete", "Suggest completions", suggest],
		["language.hover", "Show hover information", () => information(false)],
		["language.signature", "Show signature help", () => information(true)],
		["language.definition", "Go to definition", () => locations(false)],
		["language.references", "Find references", () => locations(true)],
		["language.rename", "Rename symbol", startRename],
		["language.actions", "Show code actions", actions],
		["language.format", "Format with language server", format],
		[
			"language.restart",
			"Restart language servers",
			async () => {
				await c.language.host?.restart();
				await c.language.synchronize();
				c.setMessage("Language servers restarted");
			},
		],
	] as const;
	const unregister = c.language.host
		? commands.map(([id, title, run]) =>
				c.commands.register({ id, title, execute: () => execute(run) }),
			)
		: [];
	const keydown = (event: KeyboardEvent) => {
		if (event.isComposing) return;
		if (title() && event.key === "Escape") {
			event.preventDefault();
			event.stopImmediatePropagation();
			close();
			return;
		}
		if (
			!(event.target instanceof HTMLTextAreaElement) ||
			!event.target.classList.contains("editor-input") ||
			!c.language.host
		)
			return;
		const control = event.ctrlKey || event.metaKey;
		const id =
			control && event.code === "Space"
				? event.shiftKey
					? "language.signature"
					: "language.complete"
				: event.key === "F12"
					? event.shiftKey
						? "language.references"
						: "language.definition"
					: event.key === "F2"
						? "language.rename"
						: event.altKey && event.key === "Enter"
							? "language.actions"
							: undefined;
		if (id) {
			event.preventDefault();
			event.stopImmediatePropagation();
			void c.commands.execute(id);
		}
	};
	window.addEventListener("keydown", keydown, true);
	onCleanup(() => {
		generation++;
		window.removeEventListener("keydown", keydown, true);
		for (const remove of unregister) remove();
	});
	return {
		title,
		message,
		items,
		rename,
		preview,
		close,
		execute,
		renameSymbol,
		apply: () =>
			execute(async () => {
				await preview()?.apply();
				close();
			}),
	};
}
