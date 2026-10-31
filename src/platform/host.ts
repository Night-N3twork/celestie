export interface TextFile {
	readonly id: string;
	readonly name: string;
	readonly text: string;
}

export interface FileHost {
	openTextFile(): Promise<TextFile | undefined>;
	saveTextFile(id: string, text: string): Promise<void>;
}
