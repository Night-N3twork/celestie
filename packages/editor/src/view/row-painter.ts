import type { EditorOptions } from "../api/editor-options";
import type { InlayHint, Token } from "../api/languages";
import type { Position } from "../api/types";
import type { VisibleDecoration } from "../features/decorations";
import type { SearchMatch } from "../features/search";
import { isTokenScope } from "../features/themes";
import type { TextModel } from "../model/text-model";
import { longLineLimit } from "./line-metrics";
import type { FoldRegion, VisualRow } from "./visual-layout";

interface appendRowState {
	readonly model: TextModel;
	readonly tokens: readonly Token[];
	readonly search: readonly SearchMatch[];
	readonly currentMatch: number;
	readonly brackets: readonly Position[];
	readonly decorations: readonly VisibleDecoration[];
	readonly options: EditorOptions;
	readonly accessible: boolean;
	readonly assistanceVersion: number;
	readonly hints: readonly InlayHint[];
	readonly folds: readonly FoldRegion[];
	readonly tokenStyle: (scope: string) => string | undefined;
}
export function appendRow(
	state: appendRowState,
	element: HTMLElement,
	row: VisualRow,
): void {
	const text = state.model.getLineContent(row.line),
		start = state.model.getInputOffsetAt({ line: row.line, column: 1 });
	const boundaries = new Set<number>([row.from, row.to]);
	const marks: {
		from: number;
		to: number;
		className?: string;
		style?: string;
		background?: string;
		underline?: string;
		title?: string;
	}[] = [];
	const mark = (
		from: number,
		to: number,
		options: Omit<(typeof marks)[number], "from" | "to">,
	) => {
		from = Math.max(row.from, from);
		to = Math.min(row.to, to);
		if (to < from) return;
		marks.push({ from, to, ...options });
		boundaries.add(from);
		boundaries.add(to);
	};
	let low = 0,
		high = state.tokens.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((state.tokens[mid]?.to ?? 0) < start + row.from) low = mid + 1;
		else high = mid;
	}
	for (let index = low; index < state.tokens.length; index++) {
		const token = state.tokens[index];
		if (!token || token.from > start + row.to) break;
		if (isTokenScope(token.kind)) {
			const style = state.tokenStyle(token.kind);
			mark(token.from - start, token.to - start, {
				className: `editor-token-${token.kind.split(".", 1)[0]}`,
				...(style ? { style } : {}),
			});
		}
	}
	for (let index = 0; index < state.search.length; index++) {
		const match = state.search[index];
		if (
			match &&
			row.line >= match.range.startLine &&
			row.line <= match.range.endLine
		)
			mark(
				row.line === match.range.startLine
					? match.range.startColumn - 1
					: 0,
				row.line === match.range.endLine
					? match.range.endColumn - 1
					: text.length,
				{
					className: `editor-find-match${index === state.currentMatch ? " editor-find-match-current" : ""}`,
				},
			);
	}
	for (const position of state.brackets)
		if (position.line === row.line)
			mark(position.column - 1, position.column, {
				className: "editor-matching-bracket",
			});
	for (const decoration of state.decorations) {
		const range = decoration.range;
		if (row.line >= range.startLine && row.line <= range.endLine)
			mark(
				row.line === range.startLine ? range.startColumn - 1 : 0,
				row.line === range.endLine ? range.endColumn - 1 : text.length,
				{
					...(decoration.className
						? { className: decoration.className }
						: {}),
					...(decoration.background
						? { background: decoration.background }
						: {}),
					...(decoration.underline
						? { underline: decoration.underline }
						: {}),
					...(decoration.hover ? { title: decoration.hover } : {}),
				},
			);
	}
	if (state.options.renderWhitespace === "all")
		for (let column = row.from; column < row.to; column++)
			if (/[\t ]/.test(text[column] ?? "")) {
				boundaries.add(column);
				boundaries.add(column + 1);
			}
	const hints =
		text.length <= longLineLimit &&
		state.options.inlayHints &&
		!state.accessible &&
		state.assistanceVersion === state.model.getVersionId()
			? state.hints.filter(
					(hint) =>
						hint.offset >= start + row.from &&
						hint.offset <= start + row.to,
				)
			: [];
	for (const hint of hints) boundaries.add(hint.offset - start);
	const appendHints = (column: number) => {
		for (const hint of hints.filter(
			(hint) => hint.offset - start === column,
		)) {
			const node = element.ownerDocument.createElement("span");
			node.className = "editor-inlay-hint";
			node.textContent = hint.text;
			node.title = hint.tooltip ?? hint.text;
			element.append(node);
		}
	};
	const sorted = [...boundaries].sort((a, b) => a - b);
	for (let i = 0; i < sorted.length - 1; i++) {
		const from = sorted[i] ?? 0,
			to = sorted[i + 1] ?? 0,
			active = marks.filter((mark) => mark.from < to && mark.to > from);
		appendHints(from);
		const span = element.ownerDocument.createElement("span");
		span.textContent = text.slice(from, to);
		span.className = active.map((mark) => mark.className ?? "").join(" ");
		for (const item of active) {
			if (item.style) span.style.cssText += `;${item.style}`;
			if (item.background) span.style.background = item.background;
			if (item.underline) {
				span.style.textDecorationLine = "underline";
				span.style.textDecorationStyle = "wavy";
				span.style.textDecorationColor = item.underline;
			}
			if (item.title) span.title = item.title;
		}
		if (
			state.options.renderWhitespace === "all" &&
			/^[\t ]$/.test(span.textContent)
		) {
			span.classList.add("editor-visible-whitespace");
			span.dataset.whitespace = span.textContent === "\t" ? "→" : "·";
		}
		element.append(span);
	}
	if (row.to === text.length) appendHints(row.to);
	if (!text.length) element.append(element.ownerDocument.createTextNode(""));
	if (
		state.folds.some((fold) => fold.start === row.line && fold.collapsed) &&
		row.to === text.length
	) {
		const placeholder = element.ownerDocument.createElement("span");
		placeholder.className = "editor-fold-placeholder";
		placeholder.dataset.fold = String(row.line);
		placeholder.setAttribute("aria-label", "Folded lines");
		element.append(placeholder);
	}
}
