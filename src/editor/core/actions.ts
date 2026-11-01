import { LineIndex } from "../view/lineIndex";
import type { Transaction } from "./editor";
import { type Selection, selectionRange } from "./selection";

export function lineAction(
	text: string,
	selection: Selection,
	action: "duplicate" | "delete" | "up" | "down" | "comment",
	name: string,
): Transaction | undefined {
	const lines = new LineIndex(text);
	const range = selectionRange(selection);
	const first = lines.lineAt(range.from);
	const last = lines.lineAt(
		range.to > range.from && lines.starts.includes(range.to)
			? range.to - 1
			: range.to,
	);
	const from = lines.starts[first];
	const to = lines.starts[last + 1] ?? text.length;
	const block = text.slice(from, to);
	const ending = text.includes("\r\n")
		? "\r\n"
		: text.includes("\r")
			? "\r"
			: "\n";
	if (action === "duplicate") {
		const added = /[\r\n]$/.test(block) ? block : ending + block;
		return {
			edit: { from: to, to, text: added },
			selectionAfter: { anchor: to, head: to + added.length },
		};
	}
	if (action === "delete") {
		const start =
			last === lines.count - 1 && first > 0
				? lines.ends[first - 1]
				: from;
		return {
			edit: { from: start, to, text: "" },
			selectionAfter: { anchor: start, head: start },
		};
	}
	if (action === "comment") {
		const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
		const marker = [
			"py",
			"sh",
			"bash",
			"yaml",
			"yml",
			"toml",
			"rb",
		].includes(extension)
			? "#"
			: ["sql", "lua"].includes(extension)
				? "--"
				: [
							"ts",
							"tsx",
							"js",
							"jsx",
							"c",
							"cpp",
							"h",
							"rs",
							"go",
							"java",
							"cs",
							"jsonc",
						].includes(extension)
					? "//"
					: undefined;
		if (!marker)
			throw new Error(
				"Line comments are not configured for this file type.",
			);
		const uncomment = Array.from(
			{ length: last - first + 1 },
			(_, offset) => lines.line(first + offset),
		)
			.filter((line) => line.trim())
			.every((line) => line.trimStart().startsWith(marker));
		let replacement = "";
		for (let line = first; line <= last; line++) {
			const value = lines.line(line);
			const leading = /^\s*/.exec(value)?.[0] ?? "";
			let changed = value;
			if (value.trim())
				changed = uncomment
					? leading +
						value
							.slice(leading.length + marker.length)
							.replace(/^ /, "")
					: `${leading}${marker} ${value.slice(leading.length)}`;
			replacement +=
				changed +
				text.slice(
					lines.ends[line],
					lines.starts[line + 1] ?? text.length,
				);
		}
		return {
			edit: { from, to, text: replacement },
			selectionAfter: { anchor: from, head: from + replacement.length },
		};
	}
	if (
		(action === "up" && first === 0) ||
		(action === "down" && last === lines.count - 1)
	)
		return;
	const otherFrom = action === "up" ? lines.starts[first - 1] : to;
	const otherTo =
		action === "up" ? from : (lines.starts[last + 2] ?? text.length);
	const other = text.slice(otherFrom, otherTo);
	let replacement = action === "up" ? block + other : other + block;
	if (!/[\r\n]$/.test(action === "up" ? block : other))
		replacement =
			action === "up"
				? block + ending + other.slice(0, -ending.length)
				: other + ending + block.slice(0, -ending.length);
	const start = Math.min(from, otherFrom);
	const offset =
		action === "up"
			? 0
			: other.length + (!/[\r\n]$/.test(other) ? ending.length : 0);
	return {
		edit: { from: start, to: Math.max(to, otherTo), text: replacement },
		selectionAfter: {
			anchor: start + offset,
			head: start + offset + block.replace(/[\r\n]+$/, "").length,
		},
	};
}

export function lexicalBrackets(text: string): Map<number, number> {
	const pairs = new Map<number, number>();
	const stack: { character: string; offset: number }[] = [];
	let quote = "";
	for (let offset = 0; offset < text.length; offset++) {
		const character = text[offset];
		if (quote) {
			if (character === "\\") offset++;
			else if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if (text.slice(offset, offset + 2) === "//") {
			const end = text.indexOf("\n", offset);
			offset = end < 0 ? text.length : end;
			continue;
		}
		if (text.slice(offset, offset + 2) === "/*") {
			const end = text.indexOf("*/", offset + 2);
			offset = end < 0 ? text.length : end + 1;
			continue;
		}
		if ("([{".includes(character)) stack.push({ character, offset });
		else if (")]}".includes(character)) {
			const opening = stack.at(-1);
			if (
				opening &&
				"([{"[")]}".indexOf(character)] === opening.character
			) {
				stack.pop();
				pairs.set(offset, opening.offset);
				pairs.set(opening.offset, offset);
			}
		}
	}
	return pairs;
}
