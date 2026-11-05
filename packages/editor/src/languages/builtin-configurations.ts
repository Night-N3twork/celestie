import type {
	AutoClosingPair,
	CharacterPair,
	FoldingRules,
	IndentationRules,
	LanguageConfiguration,
	OnEnterRule,
} from "./configuration";

const brackets: readonly CharacterPair[] = [
	["(", ")"],
	["[", "]"],
	["{", "}"],
];
const quotes = ['"', "'"];
const never = /(?!)/;

function closing(
	quoteMarks: readonly string[],
	extra: readonly AutoClosingPair[] = [],
): AutoClosingPair[] {
	return [
		{ open: "{", close: "}" },
		{ open: "[", close: "]" },
		{ open: "(", close: ")" },
		...quoteMarks.map((quote) => ({
			open: quote,
			close: quote,
			notIn: ["string", "comment"] as const,
		})),
		...extra,
	];
}

function markers(start: RegExp, end: RegExp, offSide?: boolean): FoldingRules {
	return { ...(offSide ? { offSide } : {}), markers: { start, end } };
}

const slashRegion = markers(
	/^\s*\/\/\s*#?region\b/,
	/^\s*\/\/\s*#?endregion\b/,
);
const hashRegion = markers(/^\s*#\s*region\b/, /^\s*#\s*endregion\b/);
const markupRegion = markers(
	/^\s*<!--\s*#?region\b.*-->/,
	/^\s*<!--\s*#?endregion\b.*-->/,
);

function commentSplit(marker: string): OnEnterRule {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	return {
		beforeText: new RegExp(`(?<!\\\\|\\w:)${escaped}\\s*\\S`),
		afterText: /^(?!\s*$).+/,
		action: { indent: "none", appendText: `${marker} ` },
	};
}

const braceIndentation: IndentationRules = {
	increaseIndentPattern:
		/^((?!\/\/).)*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)(\/\/.*|\/\*.*\*\/\s*)?$/,
	decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[}\])]/,
};
const cIndentation: IndentationRules = {
	...braceIndentation,
	indentNextLinePattern:
		/^\s*(?:(?:if|while|for)\s*\(.*\)|else(?:\s+if\s*\(.*\))?|do)\s*$/,
};

const continuation: readonly OnEnterRule[] = [
	{
		beforeText: /\\\s*$/,
		previousLineText: /^(?!.*\\\s*$)/,
		action: { indent: "indent" },
	},
	{
		beforeText: /^(?!.*\\\s*$).*\S/,
		previousLineText: /\\\s*$/,
		action: { indent: "outdent" },
	},
];

const htmlWord = /(-?\d*\.\d\w*)|([^`~!@$^&*()=+[{\]}\\|;:'",.<>/\s]+)/;
const voidElements =
	"area|base|br|col|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr";
const htmlIndentation: IndentationRules = {
	increaseIndentPattern: new RegExp(
		`<(?!\\?|(?:${voidElements})\\b|[^>]*\\/>)([-_.A-Za-z0-9]+)(?=\\s|>)\\b[^>]*>(?!.*<\\/\\1>)|<!--(?!.*-->)|\\{[^}"']*$`,
		"i",
	),
	decreaseIndentPattern: /^\s*(<\/(?!html)[-_.A-Za-z0-9]+\b[^>]*>|-->|\})/,
};
const tagEnter: readonly OnEnterRule[] = [
	{
		beforeText: new RegExp(
			`<(?!(?:${voidElements})\\b)([_:\\w][_:\\w\\-.\\d]*)(?:\\s[^/>]*)?>[^<]*$`,
			"i",
		),
		afterText: /^<\/([_:\w][_:\w\-.\d]*)\s*>/i,
		action: { indent: "indentOutdent" },
	},
];
const markup: Partial<LanguageConfiguration> = {
	blockComment: ["<!--", "-->"],
	autoClosingPairs: closing(
		['"', "'"],
		[{ open: "<!--", close: "-->", notIn: ["comment", "string"] }],
	),
	surroundingPairs: [
		['"', '"'],
		["'", "'"],
		["{", "}"],
		["[", "]"],
		["(", ")"],
		["<", ">"],
	],
	wordPattern: htmlWord,
	indentationRules: htmlIndentation,
	onEnterRules: tagEnter,
	folding: markupRegion,
};

const clike: Partial<LanguageConfiguration> = {
	lineComment: "//",
	blockComment: ["/*", "*/"],
	autoClosingPairs: closing(quotes),
	indentationRules: cIndentation,
	onEnterRules: [commentSplit("//")],
	folding: slashRegion,
};

const json: Partial<LanguageConfiguration> = {
	quotes: ['"'],
	autoClosingPairs: [
		{ open: "{", close: "}", notIn: ["string"] },
		{ open: "[", close: "]", notIn: ["string"] },
		{ open: '"', close: '"', notIn: ["string"] },
	],
};

function rules(rule: Partial<LanguageConfiguration>): LanguageConfiguration {
	return { brackets, quotes, ...rule };
}

export const languageRules = {
	plainText: rules({}),
	textOnly: rules({ quotes: [] }),
	script: rules({
		quotes: ['"', "'", "`"],
		lineComment: "//",
		blockComment: ["/*", "*/"],
		templateQuote: "`",
		regexLiterals: true,
		autoClosingPairs: closing(["'", '"', "`"]),
		indentationRules: {
			...braceIndentation,
			indentNextLinePattern:
				/^((.*=>\s*)|((.*[^\w]+|\s*)(if|while|for)\s*\(.*\)\s*))$/,
		},
		onEnterRules: [commentSplit("//")],
		folding: slashRegion,
	}),
	cFamily: rules({
		...clike,
		folding: markers(
			/^\s*(?:#pragma\s+region\b|\/\/\s*#?region\b)/,
			/^\s*(?:#pragma\s+endregion\b|\/\/\s*#?endregion\b)/,
		),
	}),
	csharp: rules({
		...clike,
		folding: markers(/^\s*#region\b/, /^\s*#endregion\b/),
	}),
	java: rules({
		...clike,
		folding: markers(
			/^\s*\/\/\s*(?:#?region\b|<editor-fold\b)/,
			/^\s*\/\/\s*(?:#?endregion\b|<\/editor-fold>)/,
		),
	}),
	braces: rules(clike),
	go: rules({
		...clike,
		quotes: ['"', "'", "`"],
		autoClosingPairs: closing(['"', "'", "`"]),
		folding: markers(/^\s*\/\/\s*region\b/, /^\s*\/\/\s*endregion\b/),
	}),
	rust: rules({
		...clike,
		quotes: ['"'],
		autoClosingPairs: closing(['"']),
		surroundingPairs: [...brackets, ['"', '"'], ["<", ">"]],
	}),
	php: rules({
		...clike,
		folding: markers(
			/^\s*(?:#|\/\/)\s*#?region\b/,
			/^\s*(?:#|\/\/)\s*#?endregion\b/,
		),
	}),
	css: rules({
		blockComment: ["/*", "*/"],
		autoClosingPairs: closing(quotes),
		indentationRules: braceIndentation,
		wordPattern:
			/(#?-?\d*\.\d\w*%?)|(::?[\w-]*(?=[^,{;]*[,{]))|(([@#.!])?[\w-?]+%?|[@#!.])/,
		folding: markers(
			/^\s*\/\*\s*#region\b.*\*\//,
			/^\s*\/\*\s*#endregion\b.*\*\//,
		),
	}),
	stylesheet: rules({
		lineComment: "//",
		blockComment: ["/*", "*/"],
		autoClosingPairs: closing(quotes),
		indentationRules: braceIndentation,
		onEnterRules: [commentSplit("//")],
		wordPattern:
			/(#?-?\d*\.\d\w*%?)|(::?[\w-]*(?=[^,{;]*[,{]))|(([@$#.!])?[\w-?]+%?|[@#!.$])/,
		folding: markers(
			/^\s*(?:\/\/|\/\*)\s*#region\b/,
			/^\s*(?:\/\/|\/\*)\s*#endregion\b/,
		),
	}),
	json: rules(json),
	jsonc: rules({
		...json,
		lineComment: "//",
		blockComment: ["/*", "*/"],
		autoClosingPairs: [
			{ open: "{", close: "}", notIn: ["string"] },
			{ open: "[", close: "]", notIn: ["string"] },
			{ open: '"', close: '"', notIn: ["string", "comment"] },
		],
		onEnterRules: [commentSplit("//")],
		folding: slashRegion,
	}),
	html: rules(markup),
	handlebars: rules({
		...markup,
		blockComment: ["{{!", "}}"],
		indentationRules: {
			increaseIndentPattern: new RegExp(
				`${htmlIndentation.increaseIndentPattern.source}|\\{\\{#(?!.*\\{\\{\\/)`,
				"i",
			),
			decreaseIndentPattern:
				/^\s*(<\/[-_.A-Za-z0-9]+\b[^>]*>|-->|\}|\{\{(?:\/|else\b))/,
		},
	}),
	razor: rules({ ...markup, blockComment: ["@*", "*@"] }),
	xml: rules({
		...markup,
		indentationRules: {
			increaseIndentPattern:
				/<(?![?!/])([\w:.-]+)(?:\s[^>]*)?(?<!\/)>(?!.*<\/\1\s*>)[^<]*$/,
			decreaseIndentPattern: /^\s*<\/[\w:.-]+\s*>/,
		},
	}),
	markdown: rules({
		blockComment: ["<!--", "-->"],
		quotes: ['"'],
		autoClosingPairs: [
			{ open: "{", close: "}" },
			{ open: "[", close: "]" },
			{ open: "(", close: ")" },
			{ open: "<", close: ">", notIn: ["string"] },
		],
		surroundingPairs: [
			["(", ")"],
			["[", "]"],
			["{", "}"],
			["`", "`"],
			["_", "_"],
			["*", "*"],
			["~", "~"],
			["$", "$"],
			['"', '"'],
			["<", ">"],
		],
		wordPattern: /[\p{L}\p{N}\p{Mn}]+(?:_[\p{L}\p{N}\p{Mn}]+)*/u,
		onEnterRules: [
			...["-", "*", "+"].flatMap((bullet): OnEnterRule[] => {
				const marker = `\\${bullet}`;
				return [
					{
						beforeText: new RegExp(
							`^\\s*${marker}\\s+\\[[ xX]\\]\\s+\\S`,
						),
						action: {
							indent: "none",
							appendText: `${bullet} [ ] `,
						},
					},
					{
						beforeText: new RegExp(`^\\s*${marker}\\s+\\S`),
						action: { indent: "none", appendText: `${bullet} ` },
					},
				];
			}),
			{
				beforeText: /^\s*>\s?\S/,
				action: { indent: "none", appendText: "> " },
			},
		],
		folding: markupRegion,
	}),
	python: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes, [
			...["r", "R", "u", "U", "f", "F", "b", "B"].flatMap((prefix) =>
				quotes.map((quote) => ({
					open: prefix + quote,
					close: quote,
					notIn: ["string", "comment"] as const,
				})),
			),
		]),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async|match|case|lambda)\b.*:\s*(?:#.*)?$/,
			decreaseIndentPattern:
				/^\s*(?:elif|else|except|finally)\b.*:\s*(?:#.*)?$/,
		},
		onEnterRules: [
			{
				beforeText:
					/^\s*(?:pass|break|continue|raise\b.*|return\b.*)\s*(?:#.*)?$/,
				action: { indent: "outdent" },
			},
			commentSplit("#"),
		],
		folding: markers(/^\s*#\s*region\b/, /^\s*#\s*endregion\b/, true),
	}),
	ruby: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes, [
			{ open: "`", close: "`", notIn: ["string", "comment"] },
		]),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:(?:(?:private|protected|public)\s+)?def|begin|class|else|elsif|ensure|for|if|module|rescue|unless|until|when|in|while|case)\b(?!.*\bend\b).*$|\bdo\b(?:\s*\|[^|]*\|)?\s*(?:#.*)?$|\{(?:\s*\|[^|]*\|)?\s*$/,
			decreaseIndentPattern:
				/^\s*(?:\}|\]|(?:end|else|elsif|rescue|ensure|when|in)\b)/,
		},
		onEnterRules: [commentSplit("#")],
		folding: hashRegion,
	}),
	hashBraces: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes),
		indentationRules: braceIndentation,
		onEnterRules: [commentSplit("#")],
		folding: hashRegion,
	}),
	powershell: rules({
		lineComment: "#",
		blockComment: ["<#", "#>"],
		autoClosingPairs: closing(quotes, [
			{ open: "<#", close: "#>", notIn: ["string"] },
		]),
		indentationRules: braceIndentation,
		onEnterRules: [commentSplit("#")],
		folding: markers(/^\s*#[rR]egion\b/, /^\s*#[eE]nd[rR]egion\b/),
	}),
	shell: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes, [
			{ open: "`", close: "`", notIn: ["string", "comment"] },
		]),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:.*\b(?:then|do)|else|.*\bin|.*\{)\s*(?:#.*)?$/,
			decreaseIndentPattern: /^\s*(?:(?:fi|done|esac|else)\b|elif\b|\})/,
		},
		onEnterRules: continuation,
		folding: hashRegion,
	}),
	dockerfile: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes),
		onEnterRules: continuation,
		folding: hashRegion,
	}),
	makefile: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes),
		indentationRules: {
			increaseIndentPattern: /^[^\s#:=][^#:=]*:(?!=).*$/,
			decreaseIndentPattern: never,
		},
		onEnterRules: continuation,
		folding: hashRegion,
	}),
	yaml: rules({
		lineComment: "#",
		autoClosingPairs: closing(quotes),
		indentationRules: {
			increaseIndentPattern:
				/^[^#'"]*:\s*(?:[|>][-+]?\d*)?\s*(?:#.*)?$|^\s*-\s*$/,
			decreaseIndentPattern: never,
		},
		onEnterRules: [commentSplit("#")],
		folding: markers(/^\s*#\s*region\b/, /^\s*#\s*endregion\b/, true),
	}),
	hashComments: rules({ lineComment: "#", folding: hashRegion }),
	plainHashComments: rules({ lineComment: "#", quotes: [] }),
	ini: rules({
		lineComment: ";",
		autoClosingPairs: closing(quotes),
		folding: markers(/^\s*[#;]\s*#?region\b/, /^\s*[#;]\s*#?endregion\b/),
	}),
	clojure: rules({
		lineComment: ";",
		quotes: ['"'],
		autoClosingPairs: closing(['"']),
		wordPattern: /[^\s()[\]{}"',;@^`~\\]+/,
		folding: markers(/^\s*;+\s*region\b/, /^\s*;+\s*endregion\b/),
	}),
	coffeescript: rules({
		lineComment: "#",
		blockComment: ["###", "###"],
		autoClosingPairs: closing(quotes),
		indentationRules: {
			increaseIndentPattern:
				/(?:[-=]>|[:=])\s*(?:#.*)?$|^\s*(?:if|else|unless|while|until|for|switch|when|try|catch|finally|class)\b(?!.*\bthen\b)/,
			decreaseIndentPattern: /^\s*(?:else|catch|finally)\b/,
		},
		onEnterRules: [commentSplit("#")],
		folding: markers(/^\s*#region\b/, /^\s*#endregion\b/, true),
	}),
	fsharp: rules({
		lineComment: "//",
		blockComment: ["(*", "*)"],
		quotes: ['"'],
		autoClosingPairs: closing(['"']),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:.*(?:=|->|\b(?:then|else|do|with|try|finally))\s*)$/,
			decreaseIndentPattern: never,
		},
		onEnterRules: [commentSplit("//")],
		folding: markers(
			/^\s*(?:\/\/\s*#region\b|\(\*\s*#region(.*)\*\))/,
			/^\s*(?:\/\/\s*#endregion\b|\(\*\s*#endregion\s*\*\))/,
			true,
		),
	}),
	julia: rules({
		lineComment: "#",
		blockComment: ["#=", "=#"],
		quotes: ['"'],
		autoClosingPairs: closing(
			['"'],
			[{ open: "`", close: "`", notIn: ["string", "comment"] }],
		),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:.*=\s*)?(?:if|while|for|function|macro|module|baremodule|(?:mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|else|elseif|catch|finally)\b(?!.*\bend\b).*$|\bdo\b(?:\s+[\w, ()]+)?\s*$/,
			decreaseIndentPattern: /^\s*(?:end|else|elseif|catch|finally)\b/,
		},
		onEnterRules: [commentSplit("#")],
		folding: markers(/^\s*#region\b/, /^\s*#endregion\b/),
	}),
	lua: rules({
		lineComment: "--",
		blockComment: ["--[[", "]]"],
		autoClosingPairs: closing(quotes),
		indentationRules: {
			increaseIndentPattern:
				/^((?!--).)*((\b(else|function|then|do|repeat)\b((?!\b(end|until)\b).)*)|(\{\s*))$/,
			decreaseIndentPattern:
				/^\s*((\b(elseif|else|end|until)\b)|(\})|(\)))/,
		},
		onEnterRules: [commentSplit("--")],
		folding: markers(/^\s*--\s*#?region\b/, /^\s*--\s*#?endregion\b/),
	}),
	sql: rules({
		lineComment: "--",
		blockComment: ["/*", "*/"],
		autoClosingPairs: closing(quotes),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:.*\b(?:BEGIN|CASE))\b(?!.*\bEND\b).*$/i,
			decreaseIndentPattern: /^\s*END\b/i,
		},
		onEnterRules: [commentSplit("--")],
		folding: markers(/^\s*--\s*#region\b/, /^\s*--\s*#endregion\b/),
	}),
	visualBasic: rules({
		lineComment: "'",
		quotes: ['"'],
		autoClosingPairs: closing(['"']),
		indentationRules: {
			increaseIndentPattern:
				/^\s*(?:(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overridable|MustOverride|NotOverridable|Async|Static|ReadOnly|WriteOnly|Shadows|Overloads|Default|Partial)\s+)*(?:Class|Module|Structure|Interface|Enum|Namespace|Sub|Function|Property|Get|Set|Operator)\b(?!.*\bEnd\b)|If\b.*\bThen\s*(?:'.*)?$|Else\b|ElseIf\b|For\b|Do\b|While\b|Select\s+Case\b|Try\b|Catch\b|Finally\b|With\b|SyncLock\b|Using\b)/i,
			decreaseIndentPattern:
				/^\s*(?:End\b|Else\b|ElseIf\b|Next\b|Loop\b|Wend\b|Catch\b|Finally\b)/i,
		},
		folding: markers(/^\s*#Region\b/i, /^\s*#End Region\b/i),
	}),
	batch: rules({
		lineComment: "REM",
		quotes: ['"'],
		autoClosingPairs: closing(['"']),
		folding: markers(
			/^\s*(?:::|@?REM)\s*#region\b/i,
			/^\s*(?:::|@?REM)\s*#endregion\b/i,
		),
	}),
	tex: rules({
		lineComment: "%",
		quotes: [],
		autoClosingPairs: [
			{ open: "{", close: "}" },
			{ open: "[", close: "]" },
			{ open: "(", close: ")" },
			{ open: "``", close: "''", notIn: ["comment"] },
		],
		surroundingPairs: [...brackets, ["$", "$"], ["`", "'"]],
		indentationRules: {
			increaseIndentPattern:
				/\\begin\{(?!document\})[^}]*\}(?!.*\\end\{)|\{[^}]*$/,
			decreaseIndentPattern: /^\s*(?:\\end\{(?!document\})|\})/,
		},
		onEnterRules: [commentSplit("%")],
		folding: markers(/^\s*%\s*#?region\b/, /^\s*%\s*#?endregion\b/),
	}),
	pug: rules({
		lineComment: "//-",
		autoClosingPairs: closing(quotes),
		folding: { offSide: true },
	}),
	restructuredText: rules({ lineComment: ".." }),
} satisfies Record<string, LanguageConfiguration>;
