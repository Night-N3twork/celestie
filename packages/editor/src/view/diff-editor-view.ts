import type {
	DiffEditorOptions,
	DiffModels,
	DiffSnapshot,
	DiffState,
} from "../api/diff";
import type { Disposable } from "../api/types";
import { DiffWorkerClient } from "../diff/client";
import { diffOptions } from "../diff/options";
import { DiffPresentation, inlinePreviewLines } from "../diff/presentation";
import { registerDiffActions } from "../features/diff-actions";
import { EditorView } from "./editor-view";

export class DiffEditorView implements Disposable {
	readonly original: EditorView;
	readonly modified: EditorView;
	private readonly root: HTMLDivElement;
	private readonly originalPane: HTMLDivElement;
	private readonly modifiedPane: HTMLDivElement;
	private readonly oldLabel: HTMLElement;
	private readonly newLabel: HTMLElement;
	private readonly status: HTMLOutputElement;
	private readonly synchronized = new WeakMap<
		EditorView,
		{ scrollTop: number; scrollLeft: number }
	>();
	private readonly buttons = new Map<string, HTMLButtonElement>();
	private readonly client = new DiffWorkerClient();
	private readonly presentation: DiffPresentation;
	private readonly subscriptions: Disposable[] = [];
	private modelSubscriptions: Disposable[] = [];
	private readonly listeners = new Set<(state: DiffState) => void>();
	private models: DiffModels | null = null;
	private options: ReturnType<typeof diffOptions>;
	private state: DiffState = { status: "empty" };
	private abort = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private originalText = "";
	private disposed = false;
	private switching = false;
	private presenting = false;
	private active = 0;
	private activeMove = -1;
	private readonly resize: ResizeObserver;
	private resizeFrame = 0;
	constructor(
		container: HTMLElement,
		models: DiffModels,
		options: DiffEditorOptions = {},
	) {
		this.options = diffOptions(options);
		this.validateModels(models);
		const doc = container.ownerDocument;
		this.root = doc.createElement("div");
		this.root.className = "editor-diff";
		this.root.setAttribute("role", "group");
		this.root.setAttribute("aria-label", "Diff editor");
		const toolbar = doc.createElement("div");
		toolbar.className = "editor-diff-toolbar";
		toolbar.setAttribute("role", "toolbar");
		toolbar.setAttribute("aria-label", "Diff controls");
		for (const [id, label] of [
			["diff.previous", "Previous change"],
			["diff.next", "Next change"],
			["diff.revert", "Revert change"],
			["diff.toggleMode", "Inline view"],
			["diff.toggleUnchanged", "Hide unchanged"],
			["diff.nextMove", "Next moved block"],
		] as const) {
			const button = doc.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.onclick = () => {
				void this.modified.executeCommand(id);
			};
			toolbar.append(button);
			this.buttons.set(id, button);
		}
		this.status = doc.createElement("output");
		this.status.setAttribute("aria-live", "polite");
		toolbar.append(this.status);
		const panes = doc.createElement("div");
		panes.className = "editor-diff-panes";
		this.originalPane = doc.createElement("div");
		this.modifiedPane = doc.createElement("div");
		this.originalPane.className = "editor-diff-pane editor-diff-original";
		this.modifiedPane.className = "editor-diff-pane editor-diff-modified";
		this.oldLabel = doc.createElement("div");
		this.newLabel = doc.createElement("div");
		this.oldLabel.className = this.newLabel.className = "editor-diff-label";
		const oldHost = doc.createElement("div"),
			newHost = doc.createElement("div");
		oldHost.className = newHost.className = "editor-diff-editor";
		this.originalPane.append(this.oldLabel, oldHost);
		this.modifiedPane.append(this.newLabel, newHost);
		panes.append(this.originalPane, this.modifiedPane);
		this.root.append(toolbar, panes);
		container.append(this.root);
		this.original = new EditorView(
			oldHost,
			models.original,
			this.paneOptions(true),
		);
		this.modified = new EditorView(
			newHost,
			models.modified,
			this.paneOptions(false),
		);
		this.presentation = new DiffPresentation(
			this.original,
			this.modified,
			this.originalPane,
			this.modifiedPane,
			(index) => {
				this.revertChange(index);
			},
			(line) => {
				this.updateOptions({ mode: "side-by-side" });
				const model = this.models?.original;
				if (model) {
					const offset = model.getInputOffsetAt({
						line: Math.min(line, model.getLineCount()),
						column: 1,
					});
					this.original.setSelections(
						[{ start: offset, end: offset, direction: "none" }],
						true,
					);
					this.original.focus();
				}
			},
		);
		const actions = {
			ready: () => this.valid() && !!this.state.result?.changes.length,
			canRevert: () => this.canRevert(),
			next: (direction: number) => this.nextChange(direction),
			nextMove: () => this.nextMove(),
			hasMoves: () => this.valid() && !!this.state.result?.moves?.length,
			revert: () => {
				this.revertChange();
			},
			toggleMode: () =>
				this.updateOptions({
					mode:
						this.options.mode === "inline"
							? "side-by-side"
							: "inline",
				}),
			toggleUnchanged: () =>
				this.updateOptions({
					hideUnchangedRegions: !this.options.hideUnchangedRegions,
				}),
		};
		this.subscriptions.push(
			registerDiffActions(this.original, actions),
			registerDiffActions(this.modified, actions),
			this.original.onDidScroll(() => this.scrolled(this.original)),
			this.modified.onDidScroll(() => this.scrolled(this.modified)),
			this.original.onDidChangeFontZoom(() =>
				this.zoomChanged(this.original),
			),
			this.modified.onDidChangeFontZoom(() =>
				this.zoomChanged(this.modified),
			),
			this.original.onDidChangeFolding(() =>
				this.foldsChanged(this.original),
			),
			this.modified.onDidChangeFolding(() =>
				this.foldsChanged(this.modified),
			),
			this.original.onDidChangeOptions(() =>
				this.paneOptionsChanged(this.original),
			),
			this.modified.onDidChangeOptions(() =>
				this.paneOptionsChanged(this.modified),
			),
		);
		for (const view of [this.original, this.modified])
			this.subscriptions.push(
				view.onDidChangeModel(() => {
					if (!this.switching && !this.disposed) {
						const original = this.original.getModel(),
							modified = this.modified.getModel();
						if (original && modified)
							this.setModels({ original, modified });
						else this.dispose();
					}
				}),
			);
		this.root.addEventListener("compositionstart", this.composition);
		this.root.addEventListener("compositionend", this.composition);
		const widths = () =>
			[this.root, this.originalPane, this.modifiedPane]
				.map((element) => element.clientWidth)
				.join(":");
		let width = widths();
		this.resize = new ResizeObserver(() => {
			const next = widths();
			if (this.disposed || next === width) return;
			width = next;
			cancelAnimationFrame(this.resizeFrame);
			this.resizeFrame = requestAnimationFrame(() => {
				this.resizeFrame = 0;
				if (!this.disposed && this.valid()) this.renderResult();
			});
		});
		this.resize.observe(this.root);
		this.resize.observe(this.originalPane);
		this.resize.observe(this.modifiedPane);
		this.setModels(models);
	}
	private paneOptions(original: boolean) {
		return {
			...this.options.editorOptions,
			ariaLabel: original
				? this.options.originalLabel
				: this.options.modifiedLabel,
			readOnly: original || this.options.readOnly,
			wordWrap: this.options.editorOptions?.wordWrap ?? ("off" as const),
			codeLens: false,
			inlayHints: false,
			stickyScroll: false,
			mouseWheelZoom: false,
			accessibilitySupport:
				this.options.editorOptions?.accessibilitySupport ??
				("off" as const),
		};
	}
	private validateModels(models: DiffModels): void {
		if (
			!models?.original ||
			!models.modified ||
			models.original.isDisposed() ||
			models.modified.isDisposed()
		)
			throw new Error("Diff models must be live text models.");
	}
	getModels(): DiffModels | null {
		return this.models ? { ...this.models } : null;
	}
	getOptions(): DiffEditorOptions {
		return {
			...this.options,
			...(this.options.editorOptions
				? { editorOptions: { ...this.options.editorOptions } }
				: {}),
		};
	}
	getState(): DiffState {
		return structuredClone(this.state);
	}
	onDidUpdate(listener: (state: DiffState) => void): Disposable {
		this.assertLive();
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}
	private emit(state: DiffState): void {
		if (this.disposed) return;
		this.state = state;
		this.updateControls();
		for (const listener of this.listeners) {
			try {
				listener(this.getState());
			} catch (error) {
				console.error("Diff state listener failed", error);
			}
		}
	}
	private assertLive(): void {
		if (this.disposed) throw new Error("Diff editor disposed.");
	}
	setModels(models: DiffModels | null): void {
		this.assertLive();
		if (this.original.isComposing || this.modified.isComposing)
			throw new Error("Finish composition before switching diff models.");
		if (models) this.validateModels(models);
		this.abort.abort();
		if (this.timer) clearTimeout(this.timer);
		this.presenting = true;
		try {
			this.presentation.clear();
		} finally {
			this.presenting = false;
		}
		for (const subscription of this.modelSubscriptions.splice(0))
			subscription.dispose();
		this.models = models ? { ...models } : null;
		this.active = 0;
		this.originalText = "";
		this.switching = true;
		try {
			this.original.setModel(models?.original ?? null);
			this.modified.setModel(models?.modified ?? null);
		} finally {
			this.switching = false;
		}
		if (models) {
			for (const model of new Set([models.original, models.modified]))
				this.modelSubscriptions.push(
					model.onDidChangeContent(() => this.schedule()),
					model.onWillDispose(() => this.dispose()),
				);
			void this.refresh();
		} else this.emit({ status: "empty" });
	}
	updateOptions(options: DiffEditorOptions): void {
		this.assertLive();
		if (this.original.isComposing || this.modified.isComposing)
			throw new Error("Finish composition before changing diff options.");
		const next = diffOptions({
			...this.options,
			...options,
			editorOptions: {
				...this.options.editorOptions,
				...options.editorOptions,
			},
		});
		this.options = next;
		this.switching = true;
		try {
			this.original.updateOptions(this.paneOptions(true));
			this.modified.updateOptions(this.paneOptions(false));
		} finally {
			this.switching = false;
		}
		void this.refresh();
	}
	private paneOptionsChanged(view: EditorView): void {
		if (this.switching || this.disposed) return;
		if (view === this.original && !view.getOptions().readOnly) {
			this.switching = true;
			try {
				view.updateOptions({ readOnly: true });
			} finally {
				this.switching = false;
			}
		}
		if (this.options.readOnly && !this.modified.getOptions().readOnly) {
			this.switching = true;
			try {
				this.modified.updateOptions({ readOnly: true });
			} finally {
				this.switching = false;
			}
		}
		this.updateControls();
		if (this.valid()) this.renderResult();
	}
	private schedule(): void {
		if (this.disposed) return;
		this.abort.abort();
		if (this.timer) clearTimeout(this.timer);
		this.emit({ status: "loading" });
		this.presenting = true;
		try {
			this.presentation.clear();
		} finally {
			this.presenting = false;
		}
		this.timer = setTimeout(() => {
			void this.refresh();
		}, 100);
	}
	async refresh(): Promise<DiffSnapshot | undefined> {
		this.assertLive();
		this.activeMove = -1;
		if (this.timer) clearTimeout(this.timer);
		this.abort.abort();
		this.abort = new AbortController();
		const signal = this.abort.signal,
			models = this.models;
		if (!models) {
			this.emit({ status: "empty" });
			return;
		}
		this.emit({ status: "loading" });
		const originalVersion = models.original.getVersionId(),
			modifiedVersion = models.modified.getVersionId(),
			original = models.original.getValue({ eol: "\n" }),
			modified = models.modified.getValue({ eol: "\n" });
		try {
			const result = await this.client.request(
				original,
				modified,
				this.options,
				signal,
			);
			if (
				signal.aborted ||
				this.disposed ||
				this.models?.original !== models.original ||
				this.models.modified !== models.modified ||
				models.original.getVersionId() !== originalVersion ||
				models.modified.getVersionId() !== modifiedVersion
			)
				return;
			const snapshot = { ...result, originalVersion, modifiedVersion };
			this.originalText = original;
			this.active = Math.min(
				this.active,
				Math.max(0, result.changes.length - 1),
			);
			this.emit({ status: "ready", result: snapshot });
			this.renderResult();
			return structuredClone(snapshot);
		} catch (error) {
			if (signal.aborted || this.disposed) return;
			this.emit({
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			this.presenting = true;
			try {
				this.presentation.clear();
			} finally {
				this.presenting = false;
			}
			return;
		}
	}
	private valid(): boolean {
		const result = this.state.result,
			models = this.models;
		return (
			!this.disposed &&
			this.state.status === "ready" &&
			!!result &&
			!!models &&
			this.original.getModel() === models.original &&
			this.modified.getModel() === models.modified &&
			models.original.getVersionId() === result.originalVersion &&
			models.modified.getVersionId() === result.modifiedVersion
		);
	}
	private native(): boolean {
		return (
			this.original.getOptions().accessibilitySupport === "on" ||
			this.modified.getOptions().accessibilitySupport === "on"
		);
	}
	private renderResult(): void {
		if (!this.valid() || !this.models || !this.state.result) return;
		this.presenting = true;
		try {
			this.presentation.render(
				this.models,
				this.state.result,
				this.options,
			);
		} finally {
			this.presenting = false;
		}
		this.updateControls();
	}
	private canRevert(): boolean {
		return (
			this.valid() &&
			!!this.state.result?.changes.length &&
			!this.options.readOnly &&
			!this.modified.getOptions().readOnly &&
			!this.original.isComposing &&
			!this.modified.isComposing
		);
	}
	revertChange(index = this.active): boolean {
		this.assertLive();
		if (!this.canRevert() || !this.models || !this.state.result)
			return false;
		const change = this.state.result.changes[index];
		if (!change) return false;
		const start = this.models.modified.getPositionAtInputOffset(
				change.modified.from,
			),
			end = this.models.modified.getPositionAtInputOffset(
				change.modified.to,
			);
		const applied = this.modified.applyEdits(
			[
				{
					range: {
						startLine: start.line,
						startColumn: start.column,
						endLine: end.line,
						endColumn: end.column,
					},
					text: this.originalText.slice(
						change.original.from,
						change.original.to,
					),
				},
			],
			this.state.result.modifiedVersion,
		);
		if (applied) this.modified.focus();
		return applied;
	}
	nextMove(direction = 1): void {
		this.assertLive();
		const moves = this.state.result?.moves;
		if (!this.valid() || !moves?.length) return;
		this.activeMove =
			this.activeMove < 0
				? direction > 0
					? 0
					: moves.length - 1
				: (this.activeMove + (direction > 0 ? 1 : -1) + moves.length) %
					moves.length;
		const move = moves[this.activeMove];
		if (!move) return;
		this.original.setSelections(
			[
				{
					start: move.original.from,
					end: move.original.to,
					direction: "forward",
				},
			],
			true,
		);
		this.modified.setSelections(
			[
				{
					start: move.modified.from,
					end: move.modified.to,
					direction: "forward",
				},
			],
			true,
		);
		this.modified.focus();
	}
	nextChange(direction = 1): void {
		this.assertLive();
		const changes = this.state.result?.changes;
		if (!this.valid() || !changes?.length || !this.models) return;
		const offset = this.modified.getSelection().start,
			nearest = changes.findIndex(
				(change) =>
					offset >= change.modified.from &&
					offset <= change.modified.to,
			);
		if (nearest >= 0)
			this.active =
				(nearest + (direction > 0 ? 1 : -1) + changes.length) %
				changes.length;
		else if (direction > 0)
			this.active = changes.findIndex(
				(change) => change.modified.from >= offset,
			);
		else {
			this.active = -1;
			for (let index = 0; index < changes.length; index++)
				if ((changes[index]?.modified.from ?? Infinity) < offset)
					this.active = index;
		}
		if (this.active < 0)
			this.active = direction > 0 ? 0 : changes.length - 1;
		const change = changes[this.active];
		if (!change) return;
		this.original.setSelections(
			[
				{
					start: change.original.from,
					end: change.original.to,
					direction: "forward",
				},
			],
			true,
		);
		this.modified.setSelections(
			[
				{
					start: change.modified.from,
					end: change.modified.to,
					direction: "forward",
				},
			],
			true,
		);
		const line = Math.min(
				change.modifiedStart + 1,
				this.models.modified.getLineCount(),
			),
			extra =
				this.options.mode === "inline" && !this.native()
					? Math.min(
							change.originalEnd - change.originalStart,
							inlinePreviewLines,
						) +
						(change.originalEnd - change.originalStart >
						inlinePreviewLines
							? 1
							: 0)
					: 0;
		this.modified.setScrollPosition({
			scrollTop: Math.max(
				0,
				this.modified.getLineTop(line) -
					(extra + 2) * this.modified.getViewport().lineHeight,
			),
		});
		this.modified.focus();
		this.updateControls();
	}
	private scrolled(source: EditorView): void {
		if (
			this.disposed ||
			this.presenting ||
			!this.valid() ||
			(this.options.mode === "inline" && !this.native())
		)
			return;
		const current = source.getViewport(),
			expected = this.synchronized.get(source);
		this.synchronized.delete(source);
		if (
			expected &&
			Math.abs(expected.scrollTop - current.scrollTop) < 0.5 &&
			Math.abs(expected.scrollLeft - current.scrollLeft) < 0.5
		)
			return;
		const target = source === this.original ? this.modified : this.original,
			position = source.getViewport();
		let top = position.scrollTop;
		if (
			(this.native() ||
				(this.state.result && !this.presentation.alignmentAvailable)) &&
			this.state.result
		) {
			const original = source === this.original,
				line = source.getLineAtScrollOffset(top) - 1;
			let mapped = line;
			for (const change of this.state.result.changes) {
				const start = original
						? change.originalStart
						: change.modifiedStart,
					end = original ? change.originalEnd : change.modifiedEnd,
					targetStart = original
						? change.modifiedStart
						: change.originalStart,
					targetEnd = original
						? change.modifiedEnd
						: change.originalEnd;
				if (line < start) break;
				if (line < end) {
					mapped =
						targetStart +
						Math.min(
							line - start,
							Math.max(0, targetEnd - targetStart - 1),
						);
					break;
				}
				mapped = line + targetEnd - end;
			}
			const count = target.getModel()?.getLineCount() ?? 1;
			top =
				target.getLineTop(Math.max(1, Math.min(count, mapped + 1))) +
				(position.scrollTop - source.getLineTop(line + 1));
		}
		const other = target.getViewport();
		if (
			Math.abs(other.scrollTop - top) > 0.5 ||
			Math.abs(other.scrollLeft - position.scrollLeft) > 0.5
		) {
			this.presenting = true;
			try {
				target.setScrollPosition({
					scrollTop: top,
					scrollLeft: position.scrollLeft,
				});
				this.synchronized.set(target, target.getViewport());
			} finally {
				this.presenting = false;
			}
		}
	}
	private updateControls(): void {
		const ready = this.valid(),
			count = this.state.result?.changes.length ?? 0;
		this.root.dataset.mode =
			this.options.mode === "inline" && !this.native()
				? "inline"
				: "side-by-side";
		this.oldLabel.textContent = this.options.originalLabel;
		this.newLabel.textContent = this.options.modifiedLabel;
		for (const [id, button] of this.buttons)
			button.disabled =
				id === "diff.revert"
					? !this.canRevert()
					: id === "diff.next" || id === "diff.previous"
						? !ready || !count
						: this.original.isComposing ||
							this.modified.isComposing;
		for (const button of this.root.querySelectorAll<HTMLButtonElement>(
			".editor-diff-change-bar button",
		))
			button.disabled = !this.canRevert();
		const mode = this.buttons.get("diff.toggleMode"),
			hide = this.buttons.get("diff.toggleUnchanged");
		mode?.setAttribute(
			"aria-pressed",
			String(this.options.mode === "inline"),
		);
		hide?.setAttribute(
			"aria-pressed",
			String(this.options.hideUnchangedRegions),
		);
		this.status.textContent =
			this.state.status === "ready"
				? `${this.state.result?.moves?.length ? `${this.state.result.moves.length} moved blocks - ` : ""}${count ? `${this.active + 1} / ${count} changes` : "No differences"}${this.state.result?.quitEarly ? ` - Limited diff (${this.state.result.reason})` : ""}${this.native() ? " - Native panes (inline zones unavailable)" : this.state.result && !this.presentation.alignmentAvailable ? " - Line-mapped scrolling" : ""}`
				: (this.state.message ??
					(this.state.status === "loading"
						? "Loading differences…"
						: "No models"));
	}
	private zoomChanged(source: EditorView): void {
		if (this.disposed || this.switching) return;
		this.switching = true;
		try {
			const target =
				source === this.original ? this.modified : this.original;
			target.setFontZoom(source.getFontZoom());
		} finally {
			this.switching = false;
		}
		this.renderResult();
	}
	private foldsChanged(source: EditorView): void {
		if (this.disposed || this.presenting) return;
		this.presenting = true;
		try {
			this.presentation.syncFolds(source);
		} finally {
			this.presenting = false;
		}
	}

	private readonly composition = (): void => {
		queueMicrotask(() => {
			if (!this.disposed) this.updateControls();
		});
	};
	dispose(): void {
		if (this.disposed) return;
		this.abort.abort();
		this.resize.disconnect();
		cancelAnimationFrame(this.resizeFrame);
		if (this.timer) clearTimeout(this.timer);
		this.client.dispose();
		this.presenting = true;
		this.presentation.dispose();
		this.disposed = true;
		for (const subscription of [
			...this.modelSubscriptions,
			...this.subscriptions,
		])
			subscription.dispose();
		this.modelSubscriptions = [];
		this.subscriptions.length = 0;
		this.originalText = "";
		this.state = { status: "empty" };
		this.listeners.clear();
		this.root.removeEventListener("compositionstart", this.composition);
		this.root.removeEventListener("compositionend", this.composition);
		this.original.dispose();
		this.modified.dispose();
		this.models = null;
		this.root.remove();
	}
}
