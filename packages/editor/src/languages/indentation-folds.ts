import type { FoldingRules } from "./configuration";

export function indentationFolds(
	text: string,
	rules: FoldingRules = {},
): { start: number; end: number }[] {
	const lines = text.split("\n"),
		stack: { line: number; indent: number }[] = [],
		markers: number[] = [],
		result: { start: number; end: number }[] = [];
	const close = (header: number, next: number): void => {
		let end = next;
		if (rules.offSide)
			while (end > header + 1 && !lines[end - 1]?.trim()) end--;
		if (end - header > 1) result.push({ start: header + 1, end });
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (rules.markers?.start.test(line)) markers.push(index);
		else if (rules.markers?.end.test(line)) {
			const start = markers.pop();
			if (start !== undefined && index > start)
				result.push({ start: start + 1, end: index + 1 });
		}
		if (!line.trim()) continue;
		const indent = (line.match(/^[\t ]*/)?.[0] ?? "").replace(
			/\t/g,
			"    ",
		).length;
		while (stack.length && indent <= (stack.at(-1)?.indent ?? 0)) {
			const old = stack.pop();
			if (old) close(old.line, index);
		}
		const previous = lines[index - 1];
		if (index && previous?.trim()) {
			const before = (previous.match(/^[\t ]*/)?.[0] ?? "").replace(
				/\t/g,
				"    ",
			).length;
			if (indent > before)
				stack.push({ line: index - 1, indent: before });
		}
	}
	for (const entry of stack) close(entry.line, lines.length);
	const starts = new Set<number>();
	return result
		.sort((a, b) => a.start - b.start || b.end - a.end)
		.filter((range) => !starts.has(range.start) && starts.add(range.start));
}
