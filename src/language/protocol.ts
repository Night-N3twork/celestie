export interface SyntaxToken {
	from: number;
	to: number;
	kind: string;
}
export interface Problem {
	id: string;
	from: number;
	to: number;
	line: number;
	column: number;
	message: string;
	code: number;
	severity: "error" | "warning";
}
export interface LanguageDocument {
	id: string;
	text: string;
	tokens: SyntaxToken[];
	problems: Problem[];
}
export interface LanguageRequest {
	version: number;
	files: { id: string; path: string; text: string }[];
	open: string[];
}
export interface LanguageResponse {
	version: number;
	documents: LanguageDocument[];
	error?: string;
}
