import type { Token } from "../api/languages";
import type { TextSelection } from "../api/types";
import { normalizeInputText } from "../view/input";

interface PayloadHost {
	getText(): string;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	getTabSize(): number;
	syntaxPalette(): SyntaxPalette | undefined;
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

export interface SyntaxPalette {
	readonly tokens: readonly Token[];
	readonly background: string;
	readonly foreground: string;
	color(kind: string): string | undefined;
}

export function highlightedHtml(
	text: string,
	start: number,
	palette: SyntaxPalette | undefined,
): string {
	if (!palette) return escapeHtml(text);
	const { tokens } = palette,
		end = start + text.length;
	let low = 0,
		high = tokens.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((tokens[mid]?.to ?? 0) <= start) low = mid + 1;
		else high = mid;
	}
	let html = "",
		position = start;
	for (let index = low; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token || token.from >= end) break;
		const from = Math.max(token.from, position),
			to = Math.min(token.to, end);
		if (to <= from) continue;
		const color = palette.color(token.kind);
		html += escapeHtml(text.slice(position - start, from - start));
		const slice = escapeHtml(text.slice(from - start, to - start));
		html += color ? `<span style="color:${color}">${slice}</span>` : slice;
		position = to;
	}
	return html + escapeHtml(text.slice(position - start));
}

export function richCopyHtml(
	body: string,
	palette: SyntaxPalette | undefined,
	tabSize: number,
): string {
	const colors = palette
		? `;background:${palette.background};color:${palette.foreground}`
		: "";
	return `<pre style="white-space:pre;tab-size:${tabSize};font-family:monospace${colors}">${body}</pre>`;
}

export function createClipboardPayload(host: PayloadHost) {
	const palette = host.syntaxPalette();
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
			if (!allWholeLine)
				return {
					start: value.start,
					text: text.slice(value.start, value.end),
				};
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
	const unique = [
		...new Map(pieces.map((piece) => [piece.start, piece])).values(),
	];
	const single = {
		start: from,
		text: text.slice(from, to) + (wholeLine && newline === -1 ? "\n" : ""),
	};
	const plain =
		selections.length > 1
			? allWholeLine
				? unique.map((piece) => piece.text).join("")
				: pieces.map((piece) => piece.text).join("\n")
			: single.text;
	const body =
		selections.length > 1
			? allWholeLine
				? unique
						.map((piece) =>
							highlightedHtml(piece.text, piece.start, palette),
						)
						.join("")
				: pieces
						.map((piece) =>
							highlightedHtml(piece.text, piece.start, palette),
						)
						.join("\n")
			: highlightedHtml(single.text, single.start, palette);
	const parts =
		selections.length > 1 ? pieces.map((piece) => piece.text) : undefined;
	return {
		plain,
		parts,
		html: richCopyHtml(body, palette, host.getTabSize()).replace(
			"<pre",
			`<pre${allWholeLine ? ' data-celestie-whole-line="true"' : ""}${parts ? ` data-celestie-selections="${encodeURIComponent(JSON.stringify(parts))}"` : ""}`,
		),
		wholeLine: allWholeLine,
		selections,
		document: text,
		selection,
	};
}
