import type { TextSelection } from "../api/types";
import type { LanguageConfiguration } from "../languages/configuration";
import { BracketAnalysis } from "./bracket-analysis";
import { type EditingPlan, type InputEdit, mapSelection } from "./editing-plan";

export function planLineComment(
	text: string,
	selection: TextSelection,
	configuration: LanguageConfiguration,
	mode?: "add" | "remove",
): EditingPlan | undefined {
	const marker = configuration.lineComment;
	if (!marker) return planBlockComment(text, selection, configuration);
	const lines: {
		from: number;
		end: number;
		indent: string;
		blank: boolean;
	}[] = [];
	let from =
		selection.start === 0
			? 0
			: text.lastIndexOf("\n", selection.start - 1) + 1;
	const last =
		selection.end > selection.start && text[selection.end - 1] === "\n"
			? selection.end - 1
			: selection.end;
	while (from <= last) {
		const newline = text.indexOf("\n", from);
		const end = newline === -1 ? text.length : newline;
		const content = text.slice(from, end);
		lines.push({
			from,
			end,
			indent: content.match(/^[\t ]*/)?.[0] ?? "",
			blank: !content.trim(),
		});
		if (newline === -1) break;
		from = newline + 1;
	}
	const meaningful = lines.filter((line) => !line.blank);
	const uncomment = mode
		? mode === "remove"
		: meaningful.length > 0 &&
			meaningful.every((line) =>
				text.startsWith(marker, line.from + line.indent.length),
			);
	let common = meaningful[0]?.indent ?? lines[0]?.indent ?? "";
	for (const line of meaningful)
		while (!line.indent.startsWith(common)) common = common.slice(0, -1);
	const edits: InputEdit[] = [];
	for (const line of lines) {
		if (line.blank && lines.length > 1) continue;
		const commented = text.startsWith(
			marker,
			line.from + line.indent.length,
		);
		if ((mode === "add" && commented) || (mode === "remove" && !commented))
			continue;
		const offset =
			line.from + (uncomment ? line.indent.length : common.length);
		const to = uncomment
			? offset +
				marker.length +
				(text[offset + marker.length] === " " ? 1 : 0)
			: offset;
		edits.push({ from: offset, to, text: uncomment ? "" : `${marker} ` });
	}
	return { edits, selection: mapSelection(selection, edits) };
}

export function planBlockComment(
	text: string,
	selection: TextSelection,
	configuration: LanguageConfiguration,
): EditingPlan | undefined {
	const pair = configuration.blockComment;
	if (!pair) return undefined;
	const [open, close] = pair;
	const { start, end } = selection;
	let edits: InputEdit[];
	if (
		text.slice(start - open.length, start) === open &&
		text.startsWith(close, end)
	) {
		edits = [
			{ from: start - open.length, to: start, text: "" },
			{ from: end, to: end + close.length, text: "" },
		];
	} else if (
		end - start >= open.length + close.length &&
		text.startsWith(open, start) &&
		text.slice(end - close.length, end) === close
	) {
		edits = [
			{ from: start, to: start + open.length, text: "" },
			{ from: end - close.length, to: end, text: "" },
		];
	} else {
		if (start === end) {
			const comment = new BracketAnalysis(
				text,
				configuration,
			).blockCommentAt(start);
			if (comment?.closed) {
				edits = [
					{
						from: comment.from,
						to: comment.from + open.length,
						text: "",
					},
					{
						from: comment.to - close.length,
						to: comment.to,
						text: "",
					},
				];
				return { edits, selection: mapSelection(selection, edits) };
			}
			return {
				edits: [{ from: start, to: end, text: open + close }],
				selection: {
					start: start + open.length,
					end: start + open.length,
					direction: "none",
				},
			};
		}
		if (text.slice(start, end).includes(close)) return undefined;
		edits = [
			{ from: start, to: start, text: open },
			{ from: end, to: end, text: close },
		];
		return {
			edits,
			selection: {
				start: start + open.length,
				end: end + open.length,
				direction: selection.direction,
			},
		};
	}
	return { edits, selection: mapSelection(selection, edits) };
}
