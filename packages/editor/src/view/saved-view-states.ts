import type { EditorViewState } from "../api/editor-options";
import type { Disposable, TextSelection } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";
import type { InputSurface } from "./input-surface";
import type { TextRenderer } from "./text-renderer";
export class SavedViewStates implements Disposable {
	private readonly savedModels = new Map<
		TextModel,
		{
			selection: TrackedRange;
			selections: {
				range: TrackedRange;
				direction: TextSelection["direction"];
				affinity?: TextSelection["affinity"];
			}[];
			direction: TextSelection["direction"];
			anchor: TrackedRange;
			scrollOffset: number;
			scrollLeft: number;
			subscription: Disposable;
		}
	>();
	remember(
		model: TextModel,
		state: EditorViewState,
		renderer: TextRenderer,
	): void {
		this.release(model);
		const selection = state.selection;
		const start = model.getPositionAtInputOffset(selection.start);
		const end = model.getPositionAtInputOffset(selection.end);
		const line = Math.max(
			1,
			Math.min(
				model.getLineCount(),
				renderer.lineAtScrollOffset(state.scrollTop),
			),
		);
		const range = model.trackRange(
			{
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column,
			},
			{ stickiness: "never" },
		);
		const anchor = model.trackRange(
			{ startLine: line, startColumn: 1, endLine: line, endColumn: 1 },
			{ stickiness: "after" },
		);
		const subscription = model.onWillDispose(() => this.release(model));
		this.savedModels.set(model, {
			selection: range,
			selections: (state.selections ?? [state.selection]).map((value) => {
				const start = model.getPositionAtInputOffset(value.start),
					end = model.getPositionAtInputOffset(value.end);
				return {
					range: model.trackRange(
						{
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column,
						},
						{ stickiness: "never" },
					),
					direction: value.direction,
					...(value.affinity ? { affinity: value.affinity } : {}),
				};
			}),
			direction: selection.direction,
			anchor,
			scrollOffset: state.scrollTop - renderer.lineTop(line),
			scrollLeft: state.scrollLeft,
			subscription,
		});
	}
	private release(model: TextModel): void {
		const state = this.savedModels.get(model);
		if (!state) return;
		state.selection.dispose();
		for (const value of state.selections) value.range.dispose();
		state.anchor.dispose();
		state.subscription.dispose();
		this.savedModels.delete(model);
	}
	restore(
		model: TextModel,
		renderer: TextRenderer,
		input: InputSurface,
		select: (values: readonly TextSelection[]) => void,
	): void {
		const state = this.savedModels.get(model);
		if (state) {
			const range = state.selection.getRange();
			const anchor = state.anchor.getRange();
			if (range)
				input.setSelectionRange(
					model.getInputOffsetAt({
						line: range.startLine,
						column: range.startColumn,
					}),
					model.getInputOffsetAt({
						line: range.endLine,
						column: range.endColumn,
					}),
					state.direction,
				);
			if (anchor)
				input.scrollTop = Math.max(
					0,
					renderer.lineTop(anchor.startLine) + state.scrollOffset,
				);
			if (range) input.scrollLeft = state.scrollLeft;
			const values = state.selections.flatMap((value) => {
				const tracked = value.range.getRange();
				return tracked
					? [
							{
								start: model.getInputOffsetAt({
									line: tracked.startLine,
									column: tracked.startColumn,
								}),
								end: model.getInputOffsetAt({
									line: tracked.endLine,
									column: tracked.endColumn,
								}),
								direction: value.direction,
								...(value.affinity
									? { affinity: value.affinity }
									: {}),
							},
						]
					: [];
			});
			if (values.length) select(values);
			this.release(model);
		}
	}
	dispose(): void {
		for (const model of [...this.savedModels.keys()]) this.release(model);
	}
}
