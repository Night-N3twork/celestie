import type { LanguageConfiguration } from "../languages/configuration";
import { mapOffset } from "../model/change-mapping";
import { TextBuffer } from "../model/text-buffer";
import { BracketAnalysis } from "./bracket-analysis";
import type { InputEdit } from "./editing-plan";
import {
	type IndentationOptions,
	indentationText,
	indentationWidth,
} from "./indentation-options";
import type { MultiEditingPlan } from "./selections";

export function reindentMovedLines(
	text: string,
	plan: MultiEditingPlan,
	configuration: LanguageConfiguration,
	options: IndentationOptions,
): MultiEditingPlan {
	const rules = configuration.indentationRules;
	if (!rules || !plan.edits.length) return plan;
	let moved = text;
	for (const edit of [...plan.edits].reverse())
		moved = moved.slice(0, edit.from) + edit.text + moved.slice(edit.to);
	const buffer = new TextBuffer(moved),
		analysis = new BracketAnalysis(moved, configuration);
	const groups: { first: number; last: number }[] = [];
	for (const selection of [...plan.selections].sort(
		(a, b) => a.start - b.start,
	)) {
		const first = buffer.getPositionAt(selection.start).line,
			end = buffer.getPositionAt(selection.end);
		const last =
				end.line -
				(selection.end > selection.start && end.column === 1 ? 1 : 0),
			previous = groups.at(-1);
		if (previous && first <= previous.last + 1)
			previous.last = Math.max(previous.last, last);
		else groups.push({ first, last });
	}
	const leading = (line: number) =>
		buffer.getLineContent(line).match(/^[\t ]*/)?.[0] ?? "";
	const width = (line: number) =>
		indentationWidth(leading(line), options.tabSize);
	const adjustments: InputEdit[] = [];
	for (const group of groups) {
		let first = group.first,
			previous = group.first - 1;
		while (first <= group.last && !buffer.getLineContent(first).trim())
			first++;
		while (previous > 0 && !buffer.getLineContent(previous).trim())
			previous--;
		if (first > group.last) continue;
		const before = previous ? buffer.getLineContent(previous) : "",
			content = buffer.getLineContent(first);
		const offset = buffer.getOffsetAt({
			line: first,
			column: leading(first).length + 1,
		});
		if (
			analysis.contextAt(offset) !== "code" ||
			rules.unIndentedLinePattern?.test(content)
		)
			continue;
		let target = previous ? width(previous) : 0;
		if (
			rules.increaseIndentPattern.test(before) ||
			rules.indentNextLinePattern?.test(before)
		)
			target += options.tabSize;
		if (rules.decreaseIndentPattern.test(content))
			target = Math.max(0, target - options.tabSize);
		const delta = target - width(first);
		if (!delta) continue;
		for (let line = group.first; line <= group.last; line++) {
			const prefix = leading(line),
				from = buffer.getOffsetAt({ line, column: 1 });
			const context = analysis.contextAt(from + prefix.length);
			if (
				context === "string" ||
				context === "template" ||
				!buffer.getLineContent(line).trim()
			)
				continue;
			const replacement = indentationText(
				Math.max(0, width(line) + delta),
				options,
			);
			if (
				replacement !== prefix &&
				plan.edits.some(
					(edit) =>
						from >= edit.from &&
						from + prefix.length <= edit.from + edit.text.length,
				)
			)
				adjustments.push({
					from,
					to: from + prefix.length,
					text: replacement,
				});
		}
	}
	if (!adjustments.length) return plan;
	adjustments.sort((a, b) => a.from - b.from);
	const changes = adjustments.map((edit) => ({
		offset: edit.from,
		length: edit.to - edit.from,
		text: edit.text,
	}));
	const edits = plan.edits.map((edit) => {
		let value = edit.text;
		for (const adjustment of adjustments
			.filter(
				(item) =>
					item.from >= edit.from &&
					item.to <= edit.from + edit.text.length,
			)
			.reverse()) {
			const from = adjustment.from - edit.from,
				to = adjustment.to - edit.from;
			value = value.slice(0, from) + adjustment.text + value.slice(to);
		}
		return { ...edit, text: value };
	});
	const selections = plan.selections.map((selection) => ({
		...selection,
		start: mapOffset(selection.start, changes, "after"),
		end: mapOffset(selection.end, changes, "after"),
	}));
	return { edits, selection: selections[0] ?? plan.selection, selections };
}
