import { handleOffset } from "./document";

export interface Selection {
	readonly anchor: number;
	readonly head: number;
}

export function validateSelection(text: string, selection: Selection): void {
	handleOffset(text, selection.anchor);
	handleOffset(text, selection.head);
}

export function selectionRange(selection: Selection) {
	return {
		from: Math.min(selection.anchor, selection.head),
		to: Math.max(selection.anchor, selection.head),
	};
}
