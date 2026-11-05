export interface SerializedPattern {
	source: string;
	flags: string;
}

export interface LanguageProfile {
	grammar?: string;
	lineComment?: string;
	blockComment?: readonly [open: string, close: string];
	quotes: readonly string[];
	templateQuote?: string;
	colorizedBrackets: readonly (readonly [open: string, close: string])[];
	keywords: readonly string[];
	word: SerializedPattern;
	folding?: {
		offSide?: boolean;
		markers?: { start: SerializedPattern; end: SerializedPattern };
	};
}

export interface EmbeddedLanguage {
	names: readonly string[];
	grammar: string;
}

export interface LanguageDocument {
	id: string;
	uri: string;
	text: string;
	version: number;
	language: string;
	profile: LanguageProfile;
}

export interface LanguageRequest {
	id: number;
	method: string;
	document?: LanguageDocument;
	documentId?: string;
	offset?: number;
	languages?: readonly EmbeddedLanguage[];
}
