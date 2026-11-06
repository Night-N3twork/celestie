export interface SnippetFormatIndent {
	readonly newline: string;
	readonly tab: string;
}
export function formatSnippetCaptures(
	format: string,
	capture: (index: number) => string,
	indent?: SnippetFormatIndent,
): string {
	let result = "";
	for (let i = 0; i < format.length; ) {
		const char = format[i++] ?? "";
		if (char === "\\" && /[$}:\\/]/.test(format[i] ?? "")) {
			result += format[i++];
			continue;
		}
		if (char !== "$") {
			result +=
				char === "\n" && indent
					? `\n${indent.newline}`
					: char === "\t" && indent
						? indent.tab
						: char;
			continue;
		}
		const simple = format.slice(i).match(/^\d+/)?.[0];
		if (simple) {
			result += capture(Number(simple));
			i += simple.length;
			continue;
		}
		if (format[i] !== "{") {
			result += "$";
			continue;
		}
		let end = i + 1,
			depth = 1;
		for (; end < format.length && depth; end++) {
			if (format[end] === "\\") end++;
			else if (format[end] === "{") depth++;
			else if (format[end] === "}") depth--;
		}
		if (depth) {
			result += format.slice(i - 1);
			break;
		}
		const expression = format.slice(i + 1, end - 1),
			match = expression.match(/^(\d+)(?::([\s\S]*))?$/);
		if (!match) {
			result += format.slice(i - 1, end);
			i = end;
			continue;
		}
		i = end;
		const value = capture(Number(match[1])),
			operation = match[2];
		const render = (text: string) =>
			formatSnippetCaptures(text, capture, indent);
		if (operation === undefined) result += value;
		else if (operation === "/upcase") result += value.toUpperCase();
		else if (operation === "/downcase") result += value.toLowerCase();
		else if (operation === "/capitalize")
			result += value.charAt(0).toUpperCase() + value.slice(1);
		else if (operation === "/camelcase" || operation === "/pascalcase")
			result += value
				.split(/[^\p{L}\p{N}]+/u)
				.filter(Boolean)
				.map(
					(word, index) =>
						(index === 0 && operation === "/camelcase"
							? word.charAt(0).toLowerCase()
							: word.charAt(0).toUpperCase()) + word.slice(1),
				)
				.join("");
		else if (operation.startsWith("+"))
			result += value ? render(operation.slice(1)) : "";
		else if (operation.startsWith("-"))
			result += value ? "" : render(operation.slice(1));
		else if (operation.startsWith("?")) {
			let split = 1,
				nested = 0;
			for (; split < operation.length; split++) {
				if (operation[split] === "\\") split++;
				else if (operation[split] === "{") nested++;
				else if (operation[split] === "}") nested--;
				else if (operation[split] === ":" && !nested) break;
			}
			result += render(
				value
					? operation.slice(1, split)
					: operation.slice(Math.min(split + 1, operation.length)),
			);
		} else result += value || render(operation);
	}
	return result;
}
