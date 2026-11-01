import { EditorSession } from "../editor/core/editor";
import type { FileHost, TextFile } from "../platform/host";

export class WorkspaceDocument {
	readonly editor: EditorSession;
	id: string;
	name: string;
	private savedText: string | undefined;
	private saving = false;
	externalText: string | undefined;
	missing = false;

	constructor(file: TextFile) {
		this.id = file.id;
		this.name = file.name;
		this.editor = new EditorSession(file.text);
		this.savedText = file.text;
	}

	get dirty(): boolean {
		return this.missing || this.editor.snapshot.text !== this.savedText;
	}

	get baseline(): string | undefined {
		return this.savedText;
	}
	markMissing(): boolean {
		if (this.missing) return false;
		this.missing = true;
		this.externalText = undefined;
		return true;
	}

	markUnsaved(baseline?: string): void {
		this.savedText = baseline;
	}

	checkExternal(text: string): boolean {
		const wasMissing = this.missing;
		const previousExternal = this.externalText;
		this.missing = false;
		if (text === this.savedText) {
			this.externalText = undefined;
			return wasMissing || previousExternal !== undefined;
		}
		if (this.dirty) {
			this.externalText = text;
			return wasMissing || previousExternal !== text;
		}
		this.reload(text);
		return true;
	}

	reload(text: string): void {
		this.editor.reset(text);
		this.savedText = text;
		this.externalText = undefined;
		this.missing = false;
	}

	async save(host: FileHost, overwrite = false): Promise<void> {
		if (this.saving) throw new Error("Saving already in progress");
		this.saving = true;
		const { text } = this.editor.snapshot;
		try {
			await host.saveTextFile(this.id, text, {
				expectedText: this.savedText,
				overwrite,
			});
			this.savedText = text;
			this.externalText = undefined;
			this.missing = false;
		} finally {
			this.saving = false;
		}
	}
}
