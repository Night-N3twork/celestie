import type { VisibleDecoration } from "../features/decorations";
import type { TextModel } from "../model/text-model";
import { longLineLimit } from "./line-metrics";

export interface InjectedText {
	readonly offset: number;
	readonly text: string;
	readonly tooltip?: string;
}

export function injectedText(
	model: TextModel,
	decorations: readonly VisibleDecoration[],
): InjectedText[] {
	const result: InjectedText[] = [];
	for (const decoration of decorations) {
		for (const side of ["before", "after"] as const) {
			const value = decoration[side];
			if (!value?.text) continue;
			const range = decoration.range;
			const position =
				side === "before"
					? { line: range.startLine, column: range.startColumn }
					: { line: range.endLine, column: range.endColumn };
			if (model.getLineLength(position.line) > longLineLimit) continue;
			result.push({ offset: model.getInputOffsetAt(position), ...value });
		}
	}
	return result;
}
