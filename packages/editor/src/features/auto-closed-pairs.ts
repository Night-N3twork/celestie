import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { TrackedRange } from "../model/tracked-ranges";

interface Pair {
	readonly open: TrackedRange;
	readonly close: TrackedRange;
	readonly text: readonly [string, string];
}
export class AutoClosedPairs implements Disposable {
	private model: TextModel | undefined;
	private pairs: Pair[] = [];
	private subscriptions: Disposable[] = [];
	private attach(model: TextModel): void {
		if (this.model === model) return;
		this.dispose();
		this.model = model;
		this.subscriptions.push(
			model.onWillDispose(() => this.dispose()),
			model.onDidChangeContent((event) => {
				if (event.undoing || event.redoing || event.flush) this.clear();
			}),
		);
	}
	private offsets(
		range: TrackedRange,
	): { from: number; to: number } | undefined {
		const value = range.getRange(),
			model = this.model;
		return value && model
			? {
					from: model.getInputOffsetAt({
						line: value.startLine,
						column: value.startColumn,
					}),
					to: model.getInputOffsetAt({
						line: value.endLine,
						column: value.endColumn,
					}),
				}
			: undefined;
	}
	owns(model: TextModel, text: string, offset: number): boolean {
		this.attach(model);
		let found = false;
		this.pairs = this.pairs.filter((pair) => {
			const open = this.offsets(pair.open),
				close = this.offsets(pair.close);
			if (
				!open ||
				!close ||
				text.slice(open.from, open.to) !== pair.text[0] ||
				text.slice(close.from, close.to) !== pair.text[1]
			) {
				pair.open.dispose();
				pair.close.dispose();
				return false;
			}
			if (offset >= close.from && offset < close.to) found = true;
			return true;
		});
		return found;
	}
	record(
		model: TextModel,
		text: string,
		offset: number,
		pair: readonly [string, string],
	): void {
		this.attach(model);
		if (
			text.slice(offset - pair[0].length, offset) !== pair[0] ||
			!text.startsWith(pair[1], offset)
		)
			return;
		const track = (from: number, to: number) => {
			const start = model.getPositionAtInputOffset(from),
				end = model.getPositionAtInputOffset(to);
			return model.trackRange(
				{
					startLine: start.line,
					startColumn: start.column,
					endLine: end.line,
					endColumn: end.column,
				},
				{ stickiness: "never" },
			);
		};
		if (this.pairs.length >= 1000) {
			const old = this.pairs.shift();
			old?.open.dispose();
			old?.close.dispose();
		}
		this.pairs.push({
			open: track(offset - pair[0].length, offset),
			close: track(offset, offset + pair[1].length),
			text: pair,
		});
	}
	private clear(): void {
		for (const pair of this.pairs) {
			pair.open.dispose();
			pair.close.dispose();
		}
		this.pairs = [];
	}
	dispose(): void {
		this.clear();
		for (const sub of this.subscriptions.splice(0)) sub.dispose();
		this.model = undefined;
	}
}
