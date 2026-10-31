import { EditorSession } from "../editor/core/editor";
import type { FileHost, TextFile } from "../platform/host";

export class WorkspaceDocument {
	readonly editor: EditorSession;
	readonly id: string;
	readonly name: string;
	private savedText: string | undefined;
	private saving = false;

	constructor(file: TextFile) {
		this.id = file.id;
		this.name = file.name;
		this.editor = new EditorSession(file.text);
		this.savedText = file.text;
	}

	get dirty(): boolean {
		return this.editor.snapshot.text !== this.savedText;
	}

	markUnsaved(): void {
		this.savedText = undefined;
	}

	async save(host: FileHost): Promise<void> {
		if (this.saving) throw new Error("Saving already in progress");
		this.saving = true;
		const { text } = this.editor.snapshot;
		try {
			await host.saveTextFile(this.id, text);
			this.savedText = text;
		} finally {
			this.saving = false;
		}
	}
}
