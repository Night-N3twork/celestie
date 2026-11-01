export interface EditorSettings {
	readonly tabSize: number;
	readonly insertSpaces: boolean;
	readonly fontSize: number;
	readonly lineNumbers: boolean;
	readonly wordWrap: boolean;
}

export const defaultEditorSettings: Readonly<EditorSettings> = Object.freeze({
	tabSize: 4,
	insertSpaces: true,
	fontSize: 14,
	lineNumbers: true,
	wordWrap: false,
});
