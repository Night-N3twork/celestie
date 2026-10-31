import type { FileHost, TextFile } from "../host";

export class MemoryFileHost implements FileHost {
	private readonly files = new Map<string, TextFile>();

	constructor(files: readonly TextFile[] = []) {
		for (const file of files) this.files.set(file.id, { ...file });
	}

	async openTextFile(): Promise<TextFile | undefined> {
		const file = this.files.values().next().value;
		return file ? { ...file } : undefined;
	}

	async saveTextFile(id: string, text: string): Promise<void> {
		const file = this.files.get(id);
		if (!file) throw new Error(`Unknown file: ${id}`);
		this.files.set(id, { ...file, text });
	}
}
