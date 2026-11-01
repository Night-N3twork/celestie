import type { TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import { offsets } from "./lsp";

export async function prepareWorkspaceEdit(
	c: WorkbenchController,
	edit: WorkspaceEdit,
) {
	const host = c.language.host;
	if (!host) throw new Error("Language server is unavailable.");
	const changes = new Map<string, TextEdit[]>();
	for (const [uri, edits] of Object.entries(edit.changes ?? {}))
		changes.set(uri, [...edits]);
	for (const change of edit.documentChanges ?? []) {
		if (!("textDocument" in change))
			throw new Error(
				"File creation, deletion and renaming are not supported by language edits yet.",
			);
		const edits = changes.get(change.textDocument.uri) ?? [];
		for (const edit of change.edits) {
			if (!("newText" in edit))
				throw new Error("Snippet workspace edits are not supported.");
			edits.push(edit);
		}
		changes.set(change.textDocument.uri, edits);
	}
	const plan = await Promise.all(
		[...changes].map(async ([uri, edits]) => {
			const id = await host.fileId(uri);
			const doc = c.documents().find((doc) => doc.id === id);
			const before =
				doc?.editor.snapshot.text ??
				(await c.host.readTextFile(id)).text;
			const sorted = edits
				.map((edit) => ({
					...offsets(before, edit.range),
					text: edit.newText,
				}))
				.sort((a, b) => b.from - a.from || b.to - a.to);
			let after = before,
				last = before.length;
			for (const edit of sorted) {
				if (edit.to > last || edit.from > edit.to || edit.from < 0)
					throw new Error(
						"Language server returned overlapping edits.",
					);
				after =
					after.slice(0, edit.from) +
					edit.text +
					after.slice(edit.to);
				last = edit.from;
			}
			return { id, before, after };
		}),
	);
	return {
		plan,
		async apply() {
			const active = c.workspace().active?.id;
			for (const item of plan) {
				const current =
					c.documents().find((doc) => doc.id === item.id)?.editor
						.snapshot.text ??
					(await c.host.readTextFile(item.id)).text;
				if (current !== item.before)
					throw new Error(
						"A file changed while preparing the edit. Try again.",
					);
			}
			for (const item of plan) {
				const doc =
					c.documents().find((doc) => doc.id === item.id) ??
					c.workspace().open(await c.host.readTextFile(item.id));
				if (doc.editor.snapshot.text !== item.before)
					throw new Error("A file changed while applying the edit.");
			}
			for (const item of plan) {
				if (
					c.documents().find((doc) => doc.id === item.id)?.editor
						.snapshot.text !== item.before
				)
					throw new Error("A file changed while applying the edit.");
			}
			for (const item of plan) {
				const doc = c.documents().find((doc) => doc.id === item.id);
				if (!doc || item.before === item.after) continue;
				doc.editor.apply({
					edit: { from: 0, to: item.before.length, text: item.after },
					selectionAfter: {
						anchor: Math.min(
							doc.editor.selection.anchor,
							item.after.length,
						),
						head: Math.min(
							doc.editor.selection.head,
							item.after.length,
						),
					},
				});
			}
			if (active) c.workspace().activate(active);
			c.changed();
			c.setRevealRequest((value) => value + 1);
		},
	};
}
