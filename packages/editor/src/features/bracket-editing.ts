import type { EditorOptions } from "../api/editor-options";
import type { TextSelection } from "../api/types";
import type {
	AutoClosingPair,
	CharacterPair,
	LanguageConfiguration,
	ScopeExclusion,
} from "../languages/configuration";
import type { BracketAnalysis } from "./bracket-analysis";
import type { EditingPlan } from "./editing-plan";
import {
	defaultIndentation,
	type IndentationOptions,
	indentationText,
	indentationUnit,
	indentationWidth,
} from "./indentation-options";
import {
	planIndentationEnter,
	planOnEnterRules,
	planTypedOutdent,
} from "./indentation-rules";

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

function defaultPairs(
	configuration: LanguageConfiguration,
): readonly CharacterPair[] {
	return [
		...configuration.brackets,
		...configuration.quotes.map((quote) => [quote, quote] as const),
	];
}

function scope(context: string): ScopeExclusion | undefined {
	return context === "line-comment" || context === "block-comment"
		? "comment"
		: context === "code"
			? undefined
			: "string";
}

function autoClosingPair(
	text: string,
	start: number,
	data: string,
	configuration: LanguageConfiguration,
	analysis: BracketAnalysis,
): AutoClosingPair | undefined {
	if (!configuration.autoClosingPairs)
		return analysis.contextAt(start) === "code"
			? defaultPairs(configuration)
					.map(([open, close]) => ({ open, close }))
					.find((pair) => pair.open === data)
			: undefined;
	let best: AutoClosingPair | undefined;
	for (const pair of configuration.autoClosingPairs) {
		const openStart = start - pair.open.length + 1;
		if (
			openStart < 0 ||
			(best && best.open.length >= pair.open.length) ||
			text.slice(openStart, start) + data !== pair.open
		)
			continue;
		const excluded = scope(analysis.contextAt(openStart));
		if (!excluded || !pair.notIn?.includes(excluded)) best = pair;
	}
	return best;
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
	options: IndentationOptions &
		Partial<
			Pick<
				EditorOptions,
				| "autoClosingBrackets"
				| "autoClosingQuotes"
				| "autoClosingComments"
				| "autoClosingDelete"
				| "autoClosingOvertype"
				| "autoSurround"
			>
		> = defaultIndentation,
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
			options.autoClosingOvertype !== false &&
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
			options.autoClosingOvertype !== false &&
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
			options.autoClosingComments !== false &&
			block &&
			collapsed &&
			data === block[0].at(-1) &&
			text.slice(start - block[0].length + 1, start) ===
				block[0].slice(0, -1) &&
			analysis.contextAt(start - block[0].length + 1) === "code" &&
			!text.startsWith(block[1], start)
		) {
			return {
				...replace(start, end, data + block[1], start + 1),
				autoClosedPair: block,
			};
		}
		if (!collapsed && options.autoSurround !== false) {
			const close = (
				configuration.surroundingPairs ?? defaultPairs(configuration)
			).find(([open]) => open === data)?.[1];
			if (close !== undefined)
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
		} else if (collapsed && !escaped(text, start)) {
			const pair = autoClosingPair(
				text,
				start,
				data,
				configuration,
				analysis,
			);
			if (pair) {
				const symmetric =
					configuration.quotes.some((quote) =>
						[...pair.close].every((unit) => unit === quote),
					) && pair.open.endsWith(pair.close);
				const wordBefore = /[\p{ID_Continue}$]/u.test(
					text[start - pair.open.length] ?? "",
				);
				const comment = block && pair.open.startsWith(block[0]);
				const enabled = comment
					? options.autoClosingComments !== false
					: symmetric
						? options.autoClosingQuotes !== false
						: options.autoClosingBrackets !== false;
				const closable =
					!next ||
					(configuration.autoCloseBefore === undefined
						? /[\s\])};,:]/u.test(next)
						: configuration.autoCloseBefore.includes(next));
				if (enabled && (!symmetric || !wordBefore) && closable)
					return {
						...((context === "code" &&
							planTypedOutdent(
								text,
								selection,
								data + pair.close,
								configuration,
								options,
								data.length,
							)) ||
							replace(
								start,
								end,
								data + pair.close,
								start + data.length,
							)),
						autoClosedPair: [pair.open, pair.close],
					};
			}
		}
		if (context === "code") {
			const outdent = planTypedOutdent(
				text,
				selection,
				data,
				configuration,
				options,
			);
			if (outdent) return outdent;
		}
	}

	if (
		collapsed &&
		(inputType === "deleteContentBackward" ||
			inputType === "deleteContentForward")
	) {
		if (
			inputType === "deleteContentBackward" &&
			options.autoClosingDelete !== false &&
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
		if (
			inputType === "deleteContentBackward" &&
			options.autoClosingDelete !== false &&
			(bracketPair || quotePair)
		)
			return replace(start - 1, end + 1, "");
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
		if (context !== "block-comment") {
			const rule = planOnEnterRules(
				text,
				selection,
				configuration,
				options,
			);
			if (rule) return rule;
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
		if (context === "code") {
			const indented = planIndentationEnter(
				text,
				selection,
				configuration,
				options,
			);
			if (indented) return indented;
		}
		return replace(start, end, `\n${indent}`);
	}
	return undefined;
}
