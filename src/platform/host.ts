export interface TextFile {
	readonly id: string;
	readonly name: string;
	readonly text: string;
}

export interface FileHost {
	openTextFile(): Promise<TextFile | undefined>;
	saveTextFile(
		id: string,
		text: string,
		options?: { expectedText?: string; overwrite?: boolean },
	): Promise<void>;
}

export interface ExplorerEntry {
	readonly id: string;
	readonly name: string;
	readonly kind: "file" | "directory";
}
