import type {
	DiffChange,
	DiffEditorOptions,
	DiffModels,
	DiffSnapshot,
} from "../api/diff";
import type { Disposable, Range } from "../api/types";
import type { Decoration, DecorationCollection } from "../features/decorations";
import type { EditorView } from "../view/editor-view";
import { DeletedBlock } from "./deleted-block";

export function diffAlignmentAvailable(snapshot: DiffSnapshot): boolean {
	return snapshot.changes.every(
		(change) =>
			Math.abs(
				change.originalEnd -
					change.originalStart -
					(change.modifiedEnd - change.modifiedStart),
			) <= 100_000,
	);
}
export const inlinePreviewLines = 10_000;
function range(model: DiffModels["original"], from: number, to: number): Range {
	const start = model.getPositionAtInputOffset(from),
		end = model.getPositionAtInputOffset(to);
	return {
		startLine: start.line,
		startColumn: start.column,
		endLine: end.line,
		endColumn: end.column,
	};
}
interface FoldPair {
	original: number;
	modified: number;
	originalEnd: number;
	modifiedEnd: number;
}
export class DiffPresentation implements Disposable {
	private assets: Disposable[] = [];
	private aligned = true;
	get alignmentAvailable(): boolean {
		return this.aligned;
	}
	private folds: FoldPair[] = [];
	private originalMarks: DecorationCollection | undefined;
	private modifiedMarks: DecorationCollection | undefined;
	private models: DiffModels | null = null;
	private blocks: DeletedBlock[] = [];
	constructor(
		private readonly original: EditorView,
		private readonly modified: EditorView,
		private readonly originalPane: HTMLElement,
		private readonly modifiedPane: HTMLElement,
		private readonly revert: (index: number) => void,
		private readonly showOriginal: (line: number) => void,
	) {}
	clear(): void {
		this.original.batchPresentation(() =>
			this.modified.batchPresentation(() => {
				for (const asset of this.assets.splice(0)) asset.dispose();
				for (const block of this.blocks.splice(0)) block.dispose();
				for (const fold of this.folds) {
					if (this.original.getModel() === this.models?.original)
						this.original.removeFold(fold.original);
					if (this.modified.getModel() === this.models?.modified)
						this.modified.removeFold(fold.modified);
				}
				this.folds = [];
				this.originalMarks?.dispose();
				this.modifiedMarks?.dispose();
				this.originalMarks = undefined;
				this.modifiedMarks = undefined;
				this.models = null;
			}),
		);
	}
	render(
		models: DiffModels,
		snapshot: DiffSnapshot,
		options: DiffEditorOptions,
	): void {
		const oldScroll = this.original.getViewport(),
			newScroll = this.modified.getViewport();
		this.original.batchPresentation(() =>
			this.modified.batchPresentation(() => {
				this.clear();
				this.models = models;
				this.originalMarks = this.original.createDecorations();
				this.modifiedMarks = this.modified.createDecorations();
				const a: Decoration[] = [],
					b: Decoration[] = [];
				for (const change of snapshot.changes) {
					this.highlight(models.original, change, true, a);
					this.highlight(models.modified, change, false, b);
				}
				for (const move of snapshot.moves ?? []) {
					for (const [model, from, to, values, other] of [
						[
							models.original,
							move.originalStart,
							move.originalEnd,
							a,
							move.modifiedStart,
						],
						[
							models.modified,
							move.modifiedStart,
							move.modifiedEnd,
							b,
							move.originalStart,
						],
					] as const) {
						values.push({
							range: {
								startLine: from + 1,
								startColumn: 1,
								endLine: to,
								endColumn: model.getLineMaxColumn(to),
							},
							wholeLine: true,
							className: "editor-diff-moved-line",
							gutter: "↕",
							overview: "var(--editor-accent)",
							hover: `Moved block ${move.id}; counterpart starts at line ${other + 1}`,
						});
					}
				}
				this.originalMarks.set(a);
				this.modifiedMarks.set(b);
				const native =
					this.modified.getOptions().accessibilitySupport === "on" ||
					this.original.getOptions().accessibilitySupport === "on";
				if (!native) {
					const inline = options.mode === "inline";
					for (const [index, change] of snapshot.changes.entries()) {
						const header =
							this.modifiedPane.ownerDocument.createElement(
								"div",
							);
						header.className = "editor-diff-change-bar";
						header.dataset.editorWidget = "diff-change";
						const button =
							header.ownerDocument.createElement("button");
						button.type = "button";
						button.textContent = "Revert change";
						button.title = `Restore original change ${index + 1}`;
						button.disabled =
							options.readOnly === true ||
							this.modified.getOptions().readOnly;
						button.onclick = () => this.revert(index);
						header.append(
							button,
							header.ownerDocument.createTextNode(
								`${change.originalEnd - change.originalStart} +${change.modifiedEnd - change.modifiedStart}`,
							),
						);
						this.zone(
							this.modified,
							change.modifiedStart,
							1,
							header,
						);
						if (inline) {
							for (
								let from = change.originalStart;
								from <
								Math.min(
									change.originalEnd,
									change.originalStart + inlinePreviewLines,
								);
								from += 1000
							) {
								const lines = Array.from(
										{
											length: Math.min(
												1000,
												change.originalEnd - from,
												change.originalStart +
													inlinePreviewLines -
													from,
											),
										},
										(_, index) =>
											models.original.getLineContent(
												from + index + 1,
											),
									),
									block = new DeletedBlock(
										this.modified,
										this.modifiedPane,
										lines,
										from,
									);
								this.blocks.push(block);
								this.zone(
									this.modified,
									change.modifiedStart,
									lines.length,
									block.node,
								);
							}
							if (
								change.originalEnd - change.originalStart >
								inlinePreviewLines
							) {
								const note =
									this.modifiedPane.ownerDocument.createElement(
										"button",
									);
								note.type = "button";
								note.className = "editor-diff-preview-limit";
								note.textContent = `${change.originalEnd - change.originalStart - inlinePreviewLines} more removed lines - Open original`;
								note.onclick = () =>
									this.showOriginal(
										change.originalStart +
											inlinePreviewLines +
											1,
									);
								this.zone(
									this.modified,
									change.modifiedStart,
									1,
									note,
								);
							}
						} else {
							const header =
								this.originalPane.ownerDocument.createElement(
									"div",
								);
							header.className = "editor-diff-change-bar";
							header.textContent = `Change ${index + 1}`;
							this.zone(
								this.original,
								change.originalStart,
								1,
								header,
							);
							const difference =
								change.originalEnd -
								change.originalStart -
								(change.modifiedEnd - change.modifiedStart);
							if (
								difference &&
								diffAlignmentAvailable(snapshot) &&
								this.modified.getOptions().wordWrap === "off" &&
								this.original.getOptions().wordWrap === "off"
							)
								this.padding(
									difference > 0
										? this.modified
										: this.original,
									difference > 0
										? change.modifiedEnd
										: change.originalEnd,
									Math.abs(difference),
								);
						}
					}
					if (options.hideUnchangedRegions)
						this.collapse(
							snapshot,
							models,
							options.contextLines ?? 3,
						);
				}
			}),
		);
		this.aligned = diffAlignmentAvailable(snapshot);
		if (
			this.aligned &&
			options.mode !== "inline" &&
			this.modified.getOptions().accessibilitySupport !== "on" &&
			this.original.getOptions().accessibilitySupport !== "on" &&
			(this.modified.getOptions().wordWrap !== "off" ||
				this.original.getOptions().wordWrap !== "off")
		) {
			const pads: {
				view: EditorView;
				afterLine: number;
				rows: number;
			}[] = [];
			const add = (
				oldFrom: number,
				oldTo: number,
				newFrom: number,
				newTo: number,
			) => {
				const height = (view: EditorView, from: number, to: number) =>
					view.getLineTop(to + 1) - view.getLineTop(from + 1);
				const difference =
					(height(this.original, oldFrom, oldTo) -
						height(this.modified, newFrom, newTo)) /
					this.modified.getViewport().lineHeight;
				if (Math.abs(difference) > 0.001)
					pads.push({
						view: difference > 0 ? this.modified : this.original,
						afterLine: difference > 0 ? newTo : oldTo,
						rows: Math.abs(difference),
					});
			};
			let oldAt = 0,
				newAt = 0;
			if (
				models.original.getLineCount() +
					models.modified.getLineCount() <=
				40000
			) {
				for (const change of [
					...snapshot.changes,
					{
						originalStart: models.original.getLineCount(),
						originalEnd: models.original.getLineCount(),
						modifiedStart: models.modified.getLineCount(),
						modifiedEnd: models.modified.getLineCount(),
					},
				]) {
					for (
						let line = 0;
						line <
						Math.min(
							change.originalStart - oldAt,
							change.modifiedStart - newAt,
						);
						line++
					)
						add(
							oldAt + line,
							oldAt + line + 1,
							newAt + line,
							newAt + line + 1,
						);
					add(
						change.originalStart,
						change.originalEnd,
						change.modifiedStart,
						change.modifiedEnd,
					);
					oldAt = change.originalEnd;
					newAt = change.modifiedEnd;
				}
			} else this.aligned = false;
			this.aligned =
				this.aligned &&
				pads.length <= 5000 &&
				pads.every((pad) => pad.rows <= 100000);
			if (this.aligned)
				this.original.batchPresentation(() =>
					this.modified.batchPresentation(() => {
						for (const pad of pads)
							if (pad.rows > 0.001)
								this.padding(pad.view, pad.afterLine, pad.rows);
					}),
				);
		}
		this.original.setScrollPosition(oldScroll);
		this.modified.setScrollPosition(newScroll);
		this.paint();
	}
	private highlight(
		model: DiffModels["original"],
		change: DiffChange,
		original: boolean,
		values: Decoration[],
	): void {
		const start = original ? change.originalStart : change.modifiedStart,
			end = original ? change.originalEnd : change.modifiedEnd,
			color = original ? "removed" : "added";
		if (end > start) {
			values.push({
				range: {
					startLine: start + 1,
					startColumn: 1,
					endLine: Math.min(end, model.getLineCount()),
					endColumn: model.getLineMaxColumn(
						Math.min(end, model.getLineCount()),
					),
				},
				wholeLine: true,
				hover: original
					? "Removed original lines"
					: "Added modified lines",
				background: `var(--editor-diff-${color}-line)`,
				gutter: original ? "−" : "+",
				overview: `var(--editor-diff-${color}-marker)`,
			});
		}
		for (const item of change.characters) {
			const span = original ? item.original : item.modified;
			if (span.to > span.from)
				values.push({
					range: range(model, span.from, span.to),
					background: `var(--editor-diff-${color}-text)`,
				});
		}
	}
	private zone(
		view: EditorView,
		afterLine: number,
		height: number,
		node: HTMLElement,
	): void {
		this.assets.push(
			view.addViewZone({
				afterLine: Math.min(
					afterLine,
					view.getModel()?.getLineCount() ?? 1,
				),
				heightInLines: height,
				node,
				focus: "return",
			}),
		);
	}
	private padding(view: EditorView, afterLine: number, count: number): void {
		for (let index = 0; index < count; index += 1000) {
			const node = this.modifiedPane.ownerDocument.createElement("div");
			node.className = "editor-diff-spacer";
			node.setAttribute("aria-hidden", "true");
			this.zone(view, afterLine, Math.min(1000, count - index), node);
		}
	}
	private collapse(
		snapshot: DiffSnapshot,
		models: DiffModels,
		context: number,
	): void {
		let a = 0,
			b = 0;
		for (const change of [
			...snapshot.changes,
			{
				originalStart: models.original.getLineCount(),
				modifiedStart: models.modified.getLineCount(),
				originalEnd: 0,
				modifiedEnd: 0,
			},
		]) {
			const count = Math.min(
					change.originalStart - a,
					change.modifiedStart - b,
				),
				skipStart = context,
				skipEnd = count - context;
			if (skipEnd - skipStart >= 3) {
				const pair = {
					original: a + skipStart,
					modified: b + skipStart,
					originalEnd: a + skipEnd,
					modifiedEnd: b + skipEnd,
				};
				this.original.createFold(pair.original, pair.originalEnd);
				this.modified.createFold(pair.modified, pair.modifiedEnd);
				this.original.setFolded(pair.original, true);
				this.modified.setFolded(pair.modified, true);
				this.folds.push(pair);
			}
			a = change.originalEnd;
			b = change.modifiedEnd;
		}
	}
	syncFolds(source: EditorView): void {
		const original = source === this.original,
			target = original ? this.modified : this.original,
			values = source.getFoldingRanges();
		target.batchPresentation(() => {
			for (const fold of this.folds) {
				const state = values.find(
					(value) =>
						value.start ===
						(original ? fold.original : fold.modified),
				);
				if (state)
					target.setFolded(
						original ? fold.modified : fold.original,
						state.collapsed,
					);
			}
		});
		this.paint();
	}
	paint(): void {
		for (const block of this.blocks) block.paint();
	}
	dispose(): void {
		this.clear();
	}
}
