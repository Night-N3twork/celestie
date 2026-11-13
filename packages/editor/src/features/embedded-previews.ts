import type {
	LanguageContext,
	Location,
	WorkspaceEdit,
} from "../api/languages";
import { Uri } from "../api/uri";
import { languageEngine } from "../languages/client";
import { TextModel } from "../model/text-model";
import { DiffEditorView } from "../view/diff-editor-view";
import { EditorView } from "../view/editor-view";
import type { LanguageFeatureHost } from "./language-host";
import type { LanguagePopup } from "./language-popup";
import { prepareWorkspacePreview } from "./workspace-preview";

export class EmbeddedPreviews {
	constructor(
		private readonly host: LanguageFeatureHost,
		private readonly popup: LanguagePopup,
	) {}
	async peek(context: LanguageContext, location: Location): Promise<void> {
		const source = await this.host
			.workspace()
			.resolve(location.uri, context.signal);
		if (
			context.signal.aborted ||
			this.host.model() !== context.model ||
			context.model.getValue({ eol: "\n" }) !== context.text ||
			!source ||
			source.text.length > 4_000_000
		)
			return;
		const live = [this.host.model(), ...languageEngine.getModels()].find(
			(model) =>
				model?.uri.toString() === location.uri && !model.isDisposed(),
		);
		const content = this.popup.widget.ownerDocument.createElement("div"),
			bar = content.ownerDocument.createElement("div"),
			container = content.ownerDocument.createElement("div");
		content.className = "editor-embedded-preview";
		container.className = "editor-peek-editor";
		const status = content.ownerDocument.createElement("div");
		status.setAttribute("role", "status");
		status.textContent = "Loading preview…";
		const open = content.ownerDocument.createElement("button");
		open.type = "button";
		open.textContent = "Open document";
		open.onclick = () => this.host.open(location);
		const apply = content.ownerDocument.createElement("button");
		apply.type = "button";
		apply.textContent = "Apply changes";
		apply.disabled = true;
		bar.append(open, apply);
		content.append(bar, status, container);
		this.popup.showContent(
			location.label ?? "Peek location",
			content,
			context.offset,
			"peek",
		);
		const abort = new AbortController();
		let view: EditorView | undefined, draft: TextModel | undefined;
		const subscriptions: { dispose(): void }[] = [];
		this.popup.ownContent({
			dispose: () => {
				abort.abort();
				for (const sub of subscriptions) sub.dispose();
				view?.dispose();
				draft?.dispose();
			},
		});
		if (live) {
			subscriptions.push(
				live.onDidChangeContent(() => {
					this.popup.close();
					this.host.announce(
						"The source changed. Open the preview again.",
					);
				}),
				live.onWillDispose(() => this.popup.close()),
			);
		}
		if (abort.signal.aborted || context.signal.aborted) return;
		draft = new TextModel(source.text, {
			register: false,
			uri: Uri.parse(`inmemory://peek/${crypto.randomUUID()}`),
			languageId: source.language,
		});
		view = new EditorView(container, draft, {
			...this.host.options(),
			minimap: false,
			stickyScroll: false,
			codeLens: false,
			inlayHints: false,
			readOnly: !live || !this.host.canEdit(),
			ariaLabel: "Peek document draft",
		});
		view.setSelections(
			[
				{
					start: Math.min(source.text.length, location.from),
					end: Math.min(source.text.length, location.to),
					direction: "forward",
				},
			],
			true,
		);
		status.textContent = live
			? "Edit this draft, then apply it to the source document."
			: "Read-only snapshot. Open the document to edit it.";
		subscriptions.push(
			draft.onDidChangeContent(() => {
				apply.disabled =
					!live ||
					!this.host.canEdit() ||
					draft?.getValue({ eol: "\n" }) === source.text;
			}),
		);
		apply.onclick = async () => {
			if (
				!draft ||
				abort.signal.aborted ||
				!this.host.canEdit() ||
				!live ||
				live.getVersionId() !== source.version
			)
				return;
			apply.disabled = true;
			try {
				await this.host.apply([
					{
						uri: source.uri,
						from: 0,
						to: source.text.length,
						text: draft.getValue({ eol: "\n" }),
						version: source.version,
					},
				]);
				if (!abort.signal.aborted) this.popup.close();
			} catch (error) {
				if (!abort.signal.aborted) {
					status.textContent = String(error);
					apply.disabled = false;
				}
			}
		};
		view.focus();
	}
	async review(
		context: LanguageContext,
		title: string,
		change: WorkspaceEdit,
	): Promise<void> {
		const prepared = await prepareWorkspacePreview(
			change,
			this.host.workspace(),
			context.signal,
		);
		if (
			context.signal.aborted ||
			this.host.model() !== context.model ||
			context.model.getValue({ eol: "\n" }) !== context.text
		)
			return;
		const doc = this.popup.widget.ownerDocument,
			content = doc.createElement("div"),
			select = doc.createElement("select"),
			container = doc.createElement("div"),
			status = doc.createElement("div"),
			apply = doc.createElement("button");
		content.className = "editor-embedded-preview";
		select.setAttribute("aria-label", "Changed document");
		container.className = "editor-action-diff";
		status.setAttribute("role", "status");
		apply.type = "button";
		apply.textContent = "Apply changes";
		for (const [index, item] of prepared.documents.entries()) {
			const option = doc.createElement("option");
			option.value = String(index);
			option.textContent = item.source.uri;
			select.append(option);
		}
		for (const operation of prepared.edit.fileOperations ?? []) {
			const label = doc.createElement("div");
			label.textContent = `${operation.kind}: ${operation.uri}${operation.kind === "rename" ? ` → ${operation.newUri}` : ""}`;
			content.append(label);
		}
		content.append(select, container, status, apply);
		this.popup.showContent(
			title,
			content,
			context.offset,
			"action-preview",
		);
		const abort = new AbortController();
		let diff: DiffEditorView | undefined;
		let models: TextModel[] = [];
		this.popup.ownContent({
			dispose: () => {
				abort.abort();
				diff?.dispose();
				for (const model of models) model.dispose();
			},
		});
		if (abort.signal.aborted || context.signal.aborted) return;
		const show = () => {
			diff?.dispose();
			for (const model of models) model.dispose();
			models = [];
			const item = prepared.documents[Number(select.value)];
			if (!item) return;
			models = [
				new TextModel(item.source.text, {
					register: false,
					languageId: item.source.language,
				}),
				new TextModel(item.text, {
					register: false,
					languageId: item.source.language,
				}),
			];
			const original = models[0],
				modified = models[1];
			if (original && modified)
				diff = new DiffEditorView(
					container,
					{ original, modified },
					{
						readOnly: true,
						editorOptions: {
							theme: this.host.options().theme,
							minimap: false,
						},
						originalLabel: "Before change",
						modifiedLabel: "After change",
					},
				);
		};
		select.onchange = show;
		show();
		select.hidden = !prepared.documents.length;
		apply.onclick = async () => {
			if (
				abort.signal.aborted ||
				context.signal.aborted ||
				!this.host.canEdit()
			)
				return;
			apply.disabled = true;
			try {
				for (const item of prepared.documents) {
					const latest = await this.host
						.workspace()
						.resolve(item.source.uri, abort.signal);
					if (
						!latest ||
						latest.version !== item.source.version ||
						latest.text !== item.source.text
					)
						throw new Error(
							"A source document changed. Request a fresh preview.",
						);
				}
				if (abort.signal.aborted || !this.host.canEdit()) return;
				await this.host.apply(prepared.edit);
				if (!abort.signal.aborted) this.popup.close();
			} catch (error) {
				if (!abort.signal.aborted) {
					status.textContent = String(error);
					apply.disabled = false;
				}
			}
		};
		apply.focus();
	}
}
