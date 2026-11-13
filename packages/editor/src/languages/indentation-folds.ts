import type { FoldingRules } from "./configuration";

export function indentationFolds(
	text: string,
	rules: FoldingRules = {},
	tabSize = 4,
): { start: number; end: number }[] {
	const lines = text.split("\n"),
		stack: { line: number; indent: number }[] = [],
		markers: number[] = [],
		result: { start: number; end: number }[] = [];
	const marker = (value: RegExp | undefined) =>
		value && new RegExp(value.source, value.flags.replace(/[gy]/g, ""));
	const opening = marker(rules.markers?.start),
		closing = marker(rules.markers?.end);
	const indentation = (text: string) => {
		let column = 0;
		for (const char of text.match(/^[\t ]*/)?.[0] ?? "")
			column += char === "\t" ? tabSize - (column % tabSize) : 1;
		return column;
	};
	let previous: { line: number; indent: number } | undefined;
	const close = (header: number, next: number): void => {
		let end = next;
		if (rules.offSide)
			while (end > header + 1 && !lines[end - 1]?.trim()) end--;
		if (end - header > 1) result.push({ start: header + 1, end });
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (opening?.test(line)) markers.push(index);
		else if (closing?.test(line)) {
			const start = markers.pop();
			if (start !== undefined && index > start)
				result.push({ start: start + 1, end: index + 1 });
		}
		if (!line.trim()) continue;
		const indent = indentation(line);
		while (stack.length && indent <= (stack.at(-1)?.indent ?? 0)) {
			const old = stack.pop();
			if (old) close(old.line, index);
		}
		if (previous && indent > previous.indent) stack.push(previous);
		previous = { line: index, indent };
	}
	for (const entry of stack) close(entry.line, lines.length);
	const starts = new Set<number>();
	return result
		.sort((a, b) => a.start - b.start || b.end - a.end)
		.filter((range) => !starts.has(range.start) && starts.add(range.start));
}
