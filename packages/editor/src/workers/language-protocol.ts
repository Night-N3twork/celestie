export interface SerializedPattern {
	source: string;
	flags: string;
}

export interface LanguageProfile {
	tokenizer?: { moduleUrl: string; version: number };
	grammar?: string;
	fencedCode?: boolean;
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
	requestId?: number;
	id: number;
	method: string;
	document?: LanguageDocument;
	documentId?: string;
	offset?: number;
	languages?: readonly EmbeddedLanguage[];
}
