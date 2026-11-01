import type { TextFile } from "../platform/host";
import { WorkspaceDocument } from "./workspaceDocument";

export class Workspace {
	private openDocuments: WorkspaceDocument[] = [];
	private activeId: string | undefined;

	get documents(): readonly WorkspaceDocument[] {
		return this.openDocuments;
	}
	get active(): WorkspaceDocument | undefined {
		return this.openDocuments.find((file) => file.id === this.activeId);
	}
	get dirty(): boolean {
		return this.openDocuments.some((file) => file.dirty);
	}

	open(file: TextFile): WorkspaceDocument {
		let document = this.openDocuments.find(
			(document) => document.id === file.id,
		);
		if (!document) {
			document = new WorkspaceDocument(file);
			this.openDocuments = [...this.openDocuments, document];
		}
		this.activeId = document.id;
		return document;
	}

	activate(id: string): void {
		if (this.openDocuments.some((document) => document.id === id))
			this.activeId = id;
	}

	reorder(id: string, direction: -1 | 1): void {
		const from = this.openDocuments.findIndex(
			(document) => document.id === id,
		);
		const to = from + direction;
		if (from < 0 || to < 0 || to >= this.openDocuments.length) return;
		const documents = [...this.openDocuments];
		[documents[from], documents[to]] = [documents[to], documents[from]];
		this.openDocuments = documents;
	}

	relocate(from: string, to: string, name: string): void {
		for (const document of this.openDocuments)
			if (document.id === from || document.id.startsWith(`${from}/`)) {
				const previous = document.id;
				document.id = to + previous.slice(from.length);
				if (previous === from) document.name = name;
				if (this.activeId === previous) this.activeId = document.id;
			}
	}

	close(id: string, discard = false): boolean {
		const index = this.openDocuments.findIndex(
			(document) => document.id === id,
		);
		const document = this.openDocuments[index];
		if (!document || (document.dirty && !discard)) return false;
		this.openDocuments = this.openDocuments.filter(
			(document) => document.id !== id,
		);
		if (this.activeId === id)
			this.activeId =
				this.openDocuments[
					Math.min(index, this.openDocuments.length - 1)
				]?.id;
		return true;
	}

	serialize(): string {
		return JSON.stringify({
			version: 1,
			activeId: this.activeId,
			documents: this.openDocuments.map((file) => ({
				id: file.id,
				name: file.name,
				text: file.editor.snapshot.text,
				dirty: file.dirty,
				savedText: file.dirty ? file.baseline : undefined,
				missing: file.missing,
				selection: file.editor.selection,
			})),
		});
	}

	static restore(raw: string): Workspace {
		const data = JSON.parse(raw);
		if (data?.version !== 1 || !Array.isArray(data.documents))
			throw new Error("Invalid workspace snapshot");
		const workspace = new Workspace();
		for (const file of data.documents) {
			if (
				!file ||
				typeof file.id !== "string" ||
				typeof file.name !== "string" ||
				typeof file.text !== "string" ||
				typeof file.dirty !== "boolean" ||
				workspace.documents.some((document) => document.id === file.id)
			)
				throw new Error("Invalid recovered document");
			const document = workspace.open(file);
			if (file.dirty)
				document.markUnsaved(
					typeof file.savedText === "string"
						? file.savedText
						: undefined,
				);
			if (file.missing === true) document.markMissing();
			if (file.selection) document.editor.setSelection(file.selection);
		}
		workspace.activate(data.activeId);
		return workspace;
	}
}
