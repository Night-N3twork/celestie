import type { TextSelection } from "../api/types";
import type {
	IndentAction,
	LanguageConfiguration,
} from "../languages/configuration";
import type { EditingPlan } from "./editing-plan";
import {
	type IndentationOptions,
	indentationText,
	indentationWidth,
} from "./indentation-options";

interface EnterContext {
	readonly prefix: string;
	readonly suffix: string;
	readonly previousLine: string;
	readonly width: number;
	readonly consumed: number;
}

function leading(line: string): string {
	return line.match(/^[\t ]*/)?.[0] ?? "";
}

function outdented(width: number, tabSize: number): number {
	return width ? Math.floor((width - 1) / tabSize) * tabSize : 0;
}

function enterContext(
	text: string,
	selection: TextSelection,
	tabSize: number,
): EnterContext {
	const lineStart =
		selection.start === 0
			? 0
			: text.lastIndexOf("\n", selection.start - 1) + 1;
	const newline = text.indexOf("\n", selection.end);
	const suffix = text.slice(
		selection.end,
		newline === -1 ? text.length : newline,
	);
	const previousStart =
		lineStart === 0 ? -1 : text.lastIndexOf("\n", lineStart - 2) + 1;
	return {
		prefix: text.slice(lineStart, selection.start),
		suffix,
		previousLine:
			previousStart < 0 ? "" : text.slice(previousStart, lineStart - 1),
		width: indentationWidth(
			leading(text.slice(lineStart, selection.start)),
			tabSize,
		),
		consumed: leading(suffix).length,
	};
}

function enterPlan(
	selection: TextSelection,
	context: EnterContext,
	action: IndentAction,
	options: IndentationOptions,
	appendText = "",
	removeText = 0,
): EditingPlan {
	const { width } = context;
	const indent = indentationText(
		action === "indent" || action === "indentOutdent"
			? width + options.tabSize
			: action === "outdent"
				? outdented(width, options.tabSize)
				: width,
		options,
	);
	const first = `\n${indent.slice(0, Math.max(0, indent.length - removeText))}${appendText}`;
	const inserted =
		action === "indentOutdent"
			? `${first}\n${indentationText(width, options)}`
			: first;
	const caret = selection.start + first.length;
	return {
		edits: [
			{
				from: selection.start,
				to: selection.end + context.consumed,
				text: inserted,
			},
		],
		selection: { start: caret, end: caret, direction: "none" },
	};
}

export function planOnEnterRules(
	text: string,
	selection: TextSelection,
	configuration: LanguageConfiguration,
	options: IndentationOptions,
): EditingPlan | undefined {
	const rules = configuration.onEnterRules;
	if (!rules?.length) return undefined;
	const context = enterContext(text, selection, options.tabSize);
	const rule = rules.find(
		(candidate) =>
			candidate.beforeText.test(context.prefix) &&
			(!candidate.afterText ||
				candidate.afterText.test(context.suffix)) &&
			(!candidate.previousLineText ||
				candidate.previousLineText.test(context.previousLine)),
	);
	return rule
		? enterPlan(
				selection,
				context,
				rule.action.indent,
				options,
				rule.action.appendText,
				rule.action.removeText,
			)
		: undefined;
}

export function planIndentationEnter(
	text: string,
	selection: TextSelection,
	configuration: LanguageConfiguration,
	options: IndentationOptions,
): EditingPlan | undefined {
	const rules = configuration.indentationRules;
	if (!rules) return undefined;
	const context = enterContext(text, selection, options.tabSize);
	if (rules.unIndentedLinePattern?.test(context.prefix)) return undefined;
	if (rules.increaseIndentPattern.test(context.prefix))
		return enterPlan(
			selection,
			context,
			rules.decreaseIndentPattern.test(context.suffix.trimStart())
				? "indentOutdent"
				: "indent",
			options,
		);
	if (rules.indentNextLinePattern?.test(context.prefix))
		return enterPlan(selection, context, "indent", options);
	const previousWidth = indentationWidth(
		leading(context.previousLine),
		options.tabSize,
	);
	if (
		rules.indentNextLinePattern?.test(context.previousLine) &&
		!rules.increaseIndentPattern.test(context.previousLine) &&
		context.width > previousWidth
	)
		return enterPlan(
			selection,
			{ ...context, width: previousWidth },
			"none",
			options,
		);
	return undefined;
}

export function planTypedOutdent(
	text: string,
	selection: TextSelection,
	data: string,
	configuration: LanguageConfiguration,
	options: IndentationOptions,
	caretInData = data.length,
): EditingPlan | undefined {
	const rules = configuration.indentationRules;
	const { start, end } = selection;
	if (!rules || start !== end) return undefined;
	const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
	const newline = text.indexOf("\n", start);
	const line = text.slice(lineStart, newline === -1 ? text.length : newline);
	const column = start - lineStart;
	const typed = line.slice(0, column) + data + line.slice(column);
	const indent = leading(line);
	if (column < indent.length || !rules.decreaseIndentPattern.test(typed))
		return undefined;
	let reference = "";
	for (
		let cursor = lineStart - 1;
		cursor > 0 && !reference.trim();
		cursor = text.lastIndexOf("\n", cursor - 1)
	) {
		const candidate = text.slice(
			text.lastIndexOf("\n", cursor - 1) + 1,
			cursor,
		);
		if (!rules.unIndentedLinePattern?.test(candidate))
			reference = candidate;
	}
	if (!reference.trim()) return undefined;
	const referenceWidth = indentationWidth(
		leading(reference),
		options.tabSize,
	);
	const target = rules.increaseIndentPattern.test(reference)
		? referenceWidth
		: outdented(referenceWidth, options.tabSize);
	if (indentationWidth(indent, options.tabSize) <= target) return undefined;
	const replacement =
		indentationText(target, options) +
		line.slice(indent.length, column) +
		data;
	const caret = lineStart + replacement.length - (data.length - caretInData);
	return {
		edits: [{ from: lineStart, to: start, text: replacement }],
		selection: { start: caret, end: caret, direction: "none" },
	};
}
