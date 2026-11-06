import type { TextSelection } from "../api/types";

export interface InputEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

export interface EditingPlan {
	readonly autoClosedPair?: readonly [open: string, close: string];
	readonly edits: readonly InputEdit[];
	readonly selection: TextSelection;
	readonly selections?: readonly TextSelection[];
}

export function mapSelection(
	selection: TextSelection,
	edits: readonly InputEdit[],
): TextSelection {
	const map = (offset: number, end: boolean): number => {
		let delta = 0;
		for (const edit of edits) {
			if (offset < edit.from) break;
			if (offset <= edit.to)
				return edit.from + delta + (end ? edit.text.length : 0);
			delta += edit.text.length - (edit.to - edit.from);
		}
		return offset + delta;
	};
	const collapsed = selection.start === selection.end;
	return {
		start: map(selection.start, collapsed),
		end: map(selection.end, true),
		direction: selection.direction,
	};
}
