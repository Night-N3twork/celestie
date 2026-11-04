import type ts from "typescript";
import type { LanguageServiceSettings } from "../api/languages";
export interface LanguageDocument {
	id: string;
	uri: string;
	text: string;
	version: number;
	language: string;
	file: string;
	keywords?: readonly string[];
}
export interface LanguageRequest {
	source?: string;
	data?: ts.CompletionEntryData;
	inlayHints?: boolean;
	codeLens?: boolean;
	settings?: LanguageServiceSettings;
	id: number;
	method: string;
	document?: LanguageDocument;
	documentId?: string;
	offset?: number;
	name?: string;
	range?: { from: number; to: number };
	options?: { tabSize: number; insertSpaces: boolean };
}
