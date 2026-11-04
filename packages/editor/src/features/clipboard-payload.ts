import type { TextSelection } from "../api/types";
import type { LanguageConfiguration } from "../languages/configuration";
import { normalizeInputText } from "../view/input";
import { BracketAnalysis } from "./bracket-analysis";

interface PayloadHost {
	getText(): string;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	getTabSize(): number;
}
export const selectionsMime = "application/x-celestie-editor-selections";
export function readSelectionParts(
	value: string,
	html = false,
): readonly string[] | undefined {
	try {
		const encoded = html
			? value.match(/data-celestie-selections="([^"]*)"/)?.[1]
			: value;
		if (!encoded) return undefined;
		const result: unknown = JSON.parse(
			html ? decodeURIComponent(encoded) : encoded,
		);
		return Array.isArray(result) &&
			result.length <= 1000 &&
			result.every((value) => typeof value === "string")
			? result.map((value) => normalizeInputText(value))
			: undefined;
	} catch {
		return undefined;
	}
}
export const wholeLineMime = "application/x-celestie-editor-line";
const escapeHtml = (text: string): string =>
	text.replace(
		/[&<>"']/g,
		(unit) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[unit] ?? unit,
	);

export function richCopyHtml(
	text: string,
	language: LanguageConfiguration,
	tabSize: number,
): string {
	const analysis = new BracketAnalysis(text, language);
	let html = "";
	for (const match of text.matchAll(
		/[\p{ID_Continue}$]+|\s+|[^\p{ID_Continue}$\s]+/gu,
	)) {
		const context = analysis.contextAt(match.index + 1);
		const color = context.includes("comment")
			? "#6a9955"
			: context === "string" || context === "template"
				? "#ce9178"
				: context === "regex"
					? "#d16969"
					: /^(const|let|var|function|return|if|else|class|interface|type|import|export|from|new|async|await|true|false|null|undefined|throw|try|catch|for|while|switch|case|break|extends|implements|public|private|readonly|number|string|boolean|void)$/.test(
								match[0],
							)
						? "#569cd6"
						: /^\d/.test(match[0])
							? "#b5cea8"
							: "";
		html += color
			? `<span style="color:${color}">${escapeHtml(match[0])}</span>`
			: escapeHtml(match[0]);
	}
	return `<pre style="white-space:pre;tab-size:${tabSize};font-family:monospace;background:#1e1e1e;color:#d4d4d4">${html}</pre>`;
}

export function createClipboardPayload(
	host: PayloadHost,
	language: LanguageConfiguration,
) {
	const text = host.getText();
	const selection = host.getSelection();
	const wholeLine = selection.start === selection.end;
	const from = wholeLine
		? selection.start === 0
			? 0
			: text.lastIndexOf("\n", selection.start - 1) + 1
		: selection.start;
	const newline = text.indexOf("\n", from);
	const to = wholeLine
		? newline === -1
			? text.length
			: newline + 1
		: selection.end;
	const selections = host.getSelections();
	const allWholeLine = selections.every((value) => value.start === value.end);
	const pieces = selections
		.slice()
		.sort((a, b) => a.start - b.start)
		.map((value) => {
			if (!allWholeLine) return text.slice(value.start, value.end);
			const start =
				value.start === 0
					? 0
					: text.lastIndexOf("\n", value.start - 1) + 1;
			const finish = text.indexOf("\n", start);
			return {
				start,
				text: `${text.slice(start, finish < 0 ? text.length : finish)}\n`,
			};
		});
	const plain =
		selections.length > 1
			? allWholeLine
				? [
						...new Map(
							pieces.map((piece) =>
								typeof piece === "string"
									? [0, piece]
									: [piece.start, piece.text],
							),
						).values(),
					].join("")
				: pieces.join("\n")
			: text.slice(from, to) + (wholeLine && newline === -1 ? "\n" : "");
	const parts =
		selections.length > 1
			? pieces.map((piece) =>
					typeof piece === "string" ? piece : piece.text,
				)
			: undefined;
	return {
		plain,
		parts,
		html: richCopyHtml(plain, language, host.getTabSize()).replace(
			"<pre",
			`<pre${allWholeLine ? ' data-celestie-whole-line="true"' : ""}${parts ? ` data-celestie-selections="${encodeURIComponent(JSON.stringify(parts))}"` : ""}`,
		),
		wholeLine: allWholeLine,
		selections,
		document: text,
		selection,
	};
}
