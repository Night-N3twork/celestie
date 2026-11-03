import type { ContentChange } from "../api/types";
import { mapOffset } from "./change-mapping";

export interface RebasedEdit {
	readonly from: number;
	readonly to: number;
	readonly text: string;
	readonly conflict: boolean;
}

export function rebaseEdit(
	edit: { from: number; to: number; text: string },
	batches: readonly (readonly ContentChange[])[],
): RebasedEdit {
	let { from, to } = edit;
	let conflict = false;
	for (const changes of batches) {
		for (const change of changes) {
			const end = change.offset + change.length;
			if (
				change.length
					? from === to
						? change.offset <= from && end > from
						: change.offset < to && end > from
					: change.offset > from && change.offset < to
			)
				conflict = true;
		}
		from = mapOffset(from, changes, "after");
		to = mapOffset(to, changes, "before");
		if (to < from) {
			to = from;
			conflict = true;
		}
	}
	return { from, to: conflict ? from : to, text: edit.text, conflict };
}
