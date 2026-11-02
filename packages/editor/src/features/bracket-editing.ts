import type { TextSelection } from "../api/types";
import type { LanguageConfiguration } from "../languages/configuration";
import type { BracketAnalysis } from "./bracket-analysis";
import type { EditingPlan } from "./editing-plan";
import {
	defaultIndentation,
	type IndentationOptions,
	indentationText,
	indentationUnit,
	indentationWidth,
} from "./indentation-options";

function replace(
	from: number,
	to: number,
	text: string,
	caret = from + text.length,
): EditingPlan {
	return {
		edits: [{ from, to, text }],
		selection: { start: caret, end: caret, direction: "none" },
	};
}

function escaped(text: string, offset: number): boolean {
	let count = 0;
	while (text[--offset] === "\\") count++;
	return count % 2 !== 0;
}

export function planBracketInput(
	text: string,
	selection: TextSelection,
	inputType: string,
	data: string | null,
	configuration: LanguageConfiguration,
	analysis: BracketAnalysis,
	options: IndentationOptions = defaultIndentation,
): EditingPlan | undefined {
	const { start, end } = selection;
	const collapsed = start === end;
	const previous = text[start - 1] ?? "";
	const next = text[end] ?? "";
	const context = analysis.contextAt(start);
	const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
	const prefix = text.slice(lineStart, start);
	const indent = indentationText(
		indentationWidth(prefix.match(/^[\t ]*/)?.[0] ?? "", options.tabSize),
		options,
	);
	const block = configuration.blockComment;

	if (inputType === "insertText" && data?.length === 1) {
		if (
			block?.[1].length === 2 &&
			collapsed &&
			context === "block-comment" &&
			data === block[1][1] &&
			previous === block[1][0]
		) {
			if (text.startsWith(block[1], start))
				return replace(start, start + 1, "", start + 1);
			if (
				next === data &&
				analysis.blockCommentAt(start)?.to === start + 1
			)
				return {
					edits: [],
					selection: {
						start: start + 1,
						end: start + 1,
						direction: "none",
					},
				};
		}
		if (
			collapsed &&
			next === data &&
			!escaped(text, start) &&
			((configuration.brackets.some(([, close]) => close === data) &&
				analysis.partner(start) !== undefined) ||
				(configuration.quotes.includes(data) &&
					analysis.isQuoteEnd(start)))
		) {
			return {
				edits: [],
				selection: {
					start: start + 1,
					end: start + 1,
					direction: "none",
				},
			};
		}
		if (
			collapsed &&
			context === "code" &&
			configuration.brackets.some(([, close]) => close === data) &&
			/^[\t ]+$/.test(prefix)
		) {
			const opening = analysis.openingBefore(start, data);
			if (opening !== undefined) {
				const openingLine = text.lastIndexOf("\n", opening - 1) + 1;
				const openingIndent =
					text.slice(openingLine, opening).match(/^[\t ]*/)?.[0] ??
					"";
				const width = (value: string): number => {
					let column = 0;
					for (const unit of value)
						column +=
							unit === "\t"
								? options.tabSize - (column % options.tabSize)
								: 1;
					return column;
				};
				if (width(prefix) > width(openingIndent))
					return replace(lineStart, end, openingIndent + data);
			}
		}
		if (
			block &&
			collapsed &&
			data === block[0].at(-1) &&
			text.slice(start - block[0].length + 1, start) ===
				block[0].slice(0, -1) &&
			analysis.contextAt(start - block[0].length + 1) === "code" &&
			!text.startsWith(block[1], start)
		) {
			return replace(start, end, data + block[1], start + 1);
		}
		const bracket = configuration.brackets.find(([open]) => open === data);
		const quote = configuration.quotes.includes(data);
		if (
			(bracket || quote) &&
			(!collapsed || (context === "code" && !escaped(text, start)))
		) {
			const close = bracket?.[1] ?? data;
			if (!collapsed)
				return {
					edits: [
						{ from: start, to: start, text: data },
						{ from: end, to: end, text: close },
					],
					selection: {
						start: start + data.length,
						end: end + data.length,
						direction: selection.direction,
					},
				};
			const wordBefore = /[\p{ID_Continue}$]/u.test(previous);
			if ((!quote || !wordBefore) && (!next || /[\s\])};,:]/u.test(next)))
				return replace(start, end, data + close, start + data.length);
		}
	}

	if (
		collapsed &&
		(inputType === "deleteContentBackward" ||
			inputType === "deleteContentForward")
	) {
		if (
			block &&
			text.slice(start - block[0].length, start) === block[0] &&
			text.startsWith(block[1], start) &&
			analysis.blockCommentAt(start)?.from === start - block[0].length
		)
			return replace(
				start - block[0].length,
				start + block[1].length,
				"",
			);
		const bracketPair =
			configuration.brackets.some(
				([open, close]) => previous === open && next === close,
			) && analysis.partner(start - 1) === start;
		const quotePair =
			configuration.quotes.includes(previous) &&
			previous === next &&
			analysis.isQuoteEnd(start) &&
			!escaped(text, start - 1);
		if (bracketPair || quotePair) return replace(start - 1, end + 1, "");
		if (
			inputType === "deleteContentBackward" &&
			prefix &&
			/^[\t ]+$/.test(prefix)
		) {
			if (previous === "\t") return replace(start - 1, start, "");
			let column = 0;
			for (const unit of prefix)
				column +=
					unit === "\t"
						? options.tabSize - (column % options.tabSize)
						: 1;
			let from = start;
			let remaining = ((column - 1) % options.tabSize) + 1;
			while (
				from > lineStart &&
				remaining > 0 &&
				text[from - 1] === " "
			) {
				from--;
				remaining--;
			}
			return replace(from, start, "");
		}
	}

	if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
		const suffix = text.slice(end);
		const leadingSpace = suffix.match(/^[\t ]*/)?.[0] ?? "";
		if (context === "block-comment" && block) {
			const commentStart = analysis.blockCommentAt(start)?.from ?? start;
			const commentLine =
				commentStart === 0
					? 0
					: text.lastIndexOf("\n", commentStart - 1) + 1;
			const baseIndent =
				text.slice(commentLine, commentStart).match(/^[\t ]*/)?.[0] ??
				"";
			const opening =
				prefix.trimEnd().endsWith(block[0]) ||
				prefix.trimEnd().endsWith(`${block[0]}*`);
			const continuation = opening
				? `${baseIndent} * `
				: prefix.match(/^(\s*\* ?)/)?.[1];
			if (continuation) {
				if (suffix.startsWith(block[1], leadingSpace.length)) {
					const first = `\n${continuation}`;
					return replace(
						start,
						end + leadingSpace.length,
						`${first}\n${baseIndent} `,
						start + first.length,
					);
				}
				return replace(start, end, `\n${continuation}`);
			}
		}
		const last = prefix.trimEnd();
		const openOffset = lineStart + last.length - 1;
		const pair = configuration.brackets.find(([open]) =>
			last.endsWith(open),
		);
		if (pair && analysis.isBracket(openOffset)) {
			const first = `\n${indent}${indentationUnit(options)}`;
			if (suffix.startsWith(pair[1], leadingSpace.length))
				return replace(
					start,
					end + leadingSpace.length,
					`${first}\n${indent}`,
					start + first.length,
				);
			return replace(start, end, first);
		}
		return replace(start, end, `\n${indent}`);
	}
	return undefined;
}
