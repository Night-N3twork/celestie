import type { Analysis, Diagnostic, Token } from "../api/languages";
import type { Disposable, TextSelection } from "../api/types";
import {
	DecorationCollection,
	diagnosticDecorations,
} from "../features/decorations";
import { type FoldingRange, FoldingState } from "../features/folding";
import { caret } from "../features/selections";

import type { TextModel } from "../model/text-model";
import type { TextRenderer } from "./text-renderer";
import {
	type ContentWidgetOptions,
	type ContentWidgetPlacement,
	type OverlayWidgetOptions,
	type ViewZone,
	type ViewZoneOptions,
	zoneRows,
} from "./widget-layer";

interface Host {
	readonly document: Document;
	model(): TextModel;
	hasModel(): boolean;
	disposed(): boolean;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	updateCursor(): void;
	executeCommand(id: string): unknown;
	runLanguageCommand(id: string): void;
	diagnosticsChanged(values: readonly Diagnostic[]): void;
}
export class ViewPresentation implements Disposable {
	private colorWidgets: Disposable[] = [];
	private readonly contentWidgets = new Set<Disposable>();
	private zoneSequence = 0;
	private readonly diagnosticOwners = new WeakMap<
		TextModel,
		Map<
			string,
			{ collection: DecorationCollection; values: readonly Diagnostic[] }
		>
	>();
	private readonly modelAssets = new Map<
		TextModel,
		{
			folding: FoldingState;
			collections: Set<DecorationCollection>;
			markers: DecorationCollection;
			subscription: Disposable;
		}
	>();
	constructor(
		private readonly host: Host,
		private readonly renderer: TextRenderer,
	) {}
	private get model() {
		return this.host.model();
	}

	private get disposed() {
		return this.host.disposed();
	}
	addContentWidget(
		id: string,
		node: HTMLElement,
		position: import("../api/types").Position,
		placement:
			| ContentWidgetPlacement
			| readonly ContentWidgetPlacement[]
			| ContentWidgetOptions = "below",
	): Disposable {
		const options: ContentWidgetOptions =
			typeof placement === "string" || Array.isArray(placement)
				? {
						placement: placement as
							| ContentWidgetPlacement
							| readonly ContentWidgetPlacement[],
					}
				: (placement as ContentWidgetOptions);
		const model = this.model,
			tracked = model.trackRange({
				startLine: position.line,
				startColumn: position.column,
				endLine: position.line,
				endColumn: position.column,
			});
		let widget: Disposable;
		try {
			widget = this.renderer.addWidget(
				id,
				node,
				() => {
					const range = tracked.getRange();
					return range
						? { line: range.startLine, column: range.startColumn }
						: position;
				},
				options,
			);
		} catch (error) {
			tracked.dispose();
			throw error;
		}
		let active = true;
		const subscription = model.onWillDispose(() => release());
		const release = () => {
			if (!active) return;
			active = false;
			widget.dispose();
			tracked.dispose();
			subscription.dispose();
			this.contentWidgets.delete(handle);
		};
		const handle = { dispose: release };
		this.contentWidgets.add(handle);
		return handle;
	}

	addOverlayWidget(
		id: string,
		node: HTMLElement,
		options: OverlayWidgetOptions,
	): Disposable {
		const widget = this.renderer.addOverlayWidget(id, node, options);
		let active = true;
		const handle = {
			dispose: () => {
				if (!active) return;
				active = false;
				widget.dispose();
				this.contentWidgets.delete(handle);
			},
		};
		this.contentWidgets.add(handle);
		return handle;
	}

	addViewZone(options: ViewZoneOptions): ViewZone {
		const model = this.model;
		if (
			!options ||
			!Number.isInteger(options.afterLine) ||
			options.afterLine < 0 ||
			options.afterLine > model.getLineCount()
		)
			throw new RangeError(
				"View zone afterLine is outside the document.",
			);
		if (options.node?.nodeType !== 1)
			throw new TypeError("View zone node must be an element.");
		let height: {
			readonly heightInLines?: number;
			readonly heightInPx?: number;
		} = {
			...(options.heightInLines !== undefined
				? { heightInLines: options.heightInLines }
				: {}),
			...(options.heightInPx !== undefined
				? { heightInPx: options.heightInPx }
				: {}),
		};
		zoneRows(height, this.renderer.lineHeight);
		const before = options.afterLine === 0,
			line = before ? 1 : options.afterLine,
			id = `view-zone-${++this.zoneSequence}`,
			tracked = model.trackRange({
				startLine: line,
				startColumn: 1,
				endLine: line,
				endColumn: 1,
			});
		const anchor = () => ({
			line: tracked.getRange()?.startLine ?? line,
			placement: before ? ("before" as const) : ("after" as const),
		});
		const scroll = this.renderer.captureAnchor();
		let zone: { dispose(): void; refresh(): void };
		try {
			zone = this.renderer.addZone(
				id,
				options.node,
				anchor,
				() => zoneRows(height, this.renderer.lineHeight),
				options.focus,
			);
		} catch (error) {
			tracked.dispose();
			throw error;
		}
		let active = true;
		this.renderer.restoreAnchor(scroll);
		const subscription = model.onWillDispose(() => release());
		const release = () => {
			if (!active) return;
			active = false;
			const scroll = this.renderer.captureAnchor();
			zone.dispose();
			tracked.dispose();
			subscription.dispose();
			this.contentWidgets.delete(handle);
			if (!this.disposed && this.host.hasModel())
				this.renderer.restoreAnchor(scroll);
		};
		const handle: ViewZone = {
			id,
			getAfterLine: () =>
				active ? (before ? 0 : anchor().line) : undefined,
			setHeight: (next) => {
				if (!active) throw new Error("View zone disposed.");
				const value = {
					...(next.heightInLines !== undefined
						? { heightInLines: next.heightInLines }
						: {}),
					...(next.heightInPx !== undefined
						? { heightInPx: next.heightInPx }
						: {}),
				};
				zoneRows(value, this.renderer.lineHeight);
				height = value;
				const scroll = this.renderer.captureAnchor();
				zone.refresh();
				this.renderer.restoreAnchor(scroll);
			},
			dispose: release,
		};
		this.contentWidgets.add(handle);
		return handle;
	}

	setLanguageAnalysis(value: Analysis): void {
		if (this.disposed || !this.host.hasModel()) return;
		const anchor = this.renderer.captureAnchor();
		this.renderer.setAssistance(
			value.hints ?? [],
			(value.lenses ?? []).map((lens) => ({
				line: this.model.getPositionAtInputOffset(lens.offset).line,
				label: lens.label,
				run: () => {
					this.host.setSelections([caret(lens.offset)], true);
					void this.host.executeCommand(lens.command);
				},
			})),
		);
		this.renderer.setTokenLayers(value.tokens, value.semanticTokens ?? []);
		this.setDiagnostics(value.diagnostics);
		this.setFoldingRanges(value.folds);
		for (const widget of this.colorWidgets.splice(0)) widget.dispose();
		this.renderer.restoreAnchor(anchor);
		for (const color of value.colors ?? []) {
			const button = this.host.document.createElement("button");
			button.type = "button";
			button.className = "editor-color-swatch";
			button.style.background = color.color;
			button.title = `Change color ${color.color}`;
			button.setAttribute("aria-label", `Change color ${color.color}`);
			button.onclick = () => {
				this.host.setSelections(
					[
						{
							start: color.from,
							end: color.to,
							direction: "forward",
						},
					],
					true,
				);
				this.host.runLanguageCommand("color");
			};
			this.colorWidgets.push(
				this.addContentWidget(
					`color-${color.from}`,
					button,
					this.model.getPositionAtInputOffset(color.from),
					"inline",
				),
			);
		}
	}

	assets(model = this.model) {
		let assets = this.modelAssets.get(model);
		if (assets) return assets;
		const collections = new Set<DecorationCollection>();
		const markers = new DecorationCollection(model, () =>
			this.refreshDecorations(model),
		);
		collections.add(markers);
		assets = {
			folding: new FoldingState(model),
			collections,
			markers,
			subscription: model.onWillDispose(() => this.releaseAssets(model)),
		};
		this.modelAssets.set(model, assets);
		return assets;
	}

	private releaseAssets(model: TextModel): void {
		const assets = this.modelAssets.get(model);
		if (!assets) return;
		this.modelAssets.delete(model);
		this.diagnosticOwners.delete(model);
		assets.subscription.dispose();
		assets.folding.dispose();
		for (const collection of assets.collections) collection.dispose();
	}

	refreshDecorations(model: TextModel): void {
		if (!this.disposed && this.model === model)
			this.renderer.setDecorations(
				[...(this.modelAssets.get(model)?.collections ?? [])].flatMap(
					(collection) => collection.get(),
				),
			);
	}

	createDecorations(): DecorationCollection {
		const model = this.model;
		const collection = new DecorationCollection(
			model,
			() => this.refreshDecorations(model),
			() => this.modelAssets.get(model)?.collections.delete(collection),
		);
		this.assets(model).collections.add(collection);
		return collection;
	}

	setDiagnostics(
		diagnostics: readonly Diagnostic[],
		owner = "language",
	): void {
		if (!owner) throw new TypeError("Diagnostic owner required.");
		let owners = this.diagnosticOwners.get(this.model);
		if (!owners) {
			owners = new Map();
			this.diagnosticOwners.set(this.model, owners);
		}
		let entry = owners.get(owner);
		if (!entry) {
			entry = {
				collection:
					owner === "language"
						? this.assets().markers
						: this.createDecorations(),
				values: [],
			};
			owners.set(owner, entry);
		}
		entry.values = diagnostics.map((diagnostic) => ({ ...diagnostic }));
		entry.collection.set(diagnosticDecorations(this.model, diagnostics));
		if (!diagnostics.length && owner !== "language") {
			entry.collection.dispose();
			owners.delete(owner);
		}
		this.host.diagnosticsChanged(this.getDiagnostics());
	}

	getDiagnostics(owner?: string): readonly Diagnostic[] {
		const owners = this.diagnosticOwners.get(this.model);
		if (!owners) return [];
		return [...owners]
			.filter(([key]) => owner === undefined || key === owner)
			.flatMap(([, entry]) =>
				entry.collection.get().flatMap((decoration, index) => {
					const original = entry.values[index];
					if (!original) return [];
					return [
						{
							...original,
							from: this.model.getInputOffsetAt({
								line: decoration.range.startLine,
								column: decoration.range.startColumn,
							}),
							to: this.model.getInputOffsetAt({
								line: decoration.range.endLine,
								column: decoration.range.endColumn,
							}),
						},
					];
				}),
			);
	}

	setSyntaxTokens(tokens: readonly Token[]): void {
		this.renderer.setTokens(tokens);
	}
	setSemanticTokens(tokens: readonly Token[]): void {
		this.renderer.setSemanticTokens(tokens);
	}

	setFoldingRanges(ranges: readonly FoldingRange[]): void {
		const anchor = this.renderer.captureAnchor();
		this.assets().folding.set(ranges);
		this.renderer.setFolds(this.assets().folding.get());
		this.renderer.restoreAnchor(anchor);
	}
	createFold(start: number, end: number): void {
		this.assets().folding.add(start, end);
		this.foldsChanged();
	}
	removeFold(line: number): void {
		this.assets().folding.remove(line);
		this.foldsChanged();
	}
	setFolded(line: number, collapsed: boolean, recursive = false): void {
		this.assets().folding.setCollapsed(line, collapsed, recursive);
		this.foldsChanged();
	}
	foldLevel(level: number): void {
		this.assets().folding.level(level);
		this.foldsChanged();
	}
	private foldsChanged(): void {
		const anchor = this.renderer.captureAnchor(),
			folds = this.assets().folding.get();
		this.renderer.setFolds(folds);
		const visibleOffset = (offset: number) => {
			const position = this.model.getPositionAtInputOffset(offset);
			const parent = folds.find(
				(fold) =>
					fold.collapsed &&
					position.line > fold.start &&
					position.line <= fold.end,
			);
			return parent
				? this.model.getInputOffsetAt({
						line: parent.start,
						column: this.model.getLineMaxColumn(parent.start),
					})
				: offset;
		};
		const selections = this.host.getSelections().map((selection) => ({
			...selection,
			start: visibleOffset(selection.start),
			end: visibleOffset(selection.end),
		}));
		this.host.setSelections(selections);
		this.renderer.restoreAnchor(anchor);
		this.host.updateCursor();
	}

	toggleFold(line?: number): void {
		const selection = this.host.getSelection(),
			folding = this.assets().folding,
			position = this.model.getPositionAtInputOffset(
				selection.direction === "backward"
					? selection.start
					: selection.end,
			);
		const region =
			line === undefined
				? folding
						.get()
						.filter(
							(region) =>
								region.start <= position.line &&
								region.end >= position.line,
						)
						.sort((a, b) => b.start - a.start)[0]
				: folding.get().find((region) => region.start === line);
		if (!region) return;
		folding.toggle(region.start);
		this.foldsChanged();
	}

	foldAll(collapsed: boolean): void {
		this.assets().folding.all(collapsed);
		this.foldsChanged();
	}

	clearColors(): void {
		for (const widget of this.colorWidgets.splice(0)) widget.dispose();
	}
	dispose(): void {
		this.clearColors();
		for (const widget of [...this.contentWidgets]) widget.dispose();
		for (const model of [...this.modelAssets.keys()])
			this.releaseAssets(model);
	}
}
