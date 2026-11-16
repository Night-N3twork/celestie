import type { SearchMatch } from "./search";

export function preserveReplacementCase(
	replacement: string,
	matched: string,
): string {
	if (!matched || !replacement) return replacement;
	const separators = ["-", "_"].filter(
		(separator) =>
			matched.includes(separator) &&
			replacement.includes(separator) &&
			matched.split(separator).length ===
				replacement.split(separator).length,
	);
	if (separators.length === 1) {
		const separator = separators[0] ?? "",
			parts = matched.split(separator);
		return replacement
			.split(separator)
			.map((part, index) =>
				preserveReplacementCase(part, parts[index] ?? ""),
			)
			.join(separator);
	}
	if (matched === matched.toUpperCase()) return replacement.toUpperCase();
	if (matched === matched.toLowerCase()) return replacement.toLowerCase();
	const first = [...matched][0] ?? "",
		prefix = [...replacement][0] ?? "";
	if (first !== first.toLowerCase())
		return prefix.toUpperCase() + replacement.slice(prefix.length);
	if (first !== first.toUpperCase())
		return prefix.toLowerCase() + replacement.slice(prefix.length);
	return replacement;
}

function captureCase(value: string, operations: readonly string[]): string {
	let operation = 0;
	return [...value]
		.map((char) => {
			const current = operations[operation];
			if (current === "u" || current === "l") operation++;
			return current === "u" || current === "U"
				? char.toUpperCase()
				: current === "l" || current === "L"
					? char.toLowerCase()
					: char;
		})
		.join("");
}

export function expandRegexReplacement(
	replacement: string,
	match: SearchMatch,
	source: string,
	budget = 16000000,
): string {
	if (replacement.length > budget)
		throw new RangeError("Replacement is too large.");
	const pieces: string[] = [],
		captures = match.captures ?? [],
		operations: string[] = [];
	let length = 0;
	const append = (value: string) => {
		length += value.length;
		if (length > budget) throw new RangeError("Replacement is too large.");
		pieces.push(value);
	};
	for (let index = 0; index < replacement.length; ) {
		const char = replacement[index++] ?? "";
		if (char === "\\") {
			const next = replacement[index] ?? "";
			if (/[uUlL]/.test(next) && next) {
				operations.push(next);
				index++;
				continue;
			}
			if (next === "n" || next === "t" || next === "\\") {
				append(next === "n" ? "\n" : next === "t" ? "\t" : "\\");
				index++;
				continue;
			}
		}
		if (char !== "$") {
			append(char);
			continue;
		}
		const token = replacement
			.slice(index)
			.match(/^(\$|&|`|'|<([^>]+)>|[0-9]{1,2})/);
		if (!token) {
			append(char);
			continue;
		}
		index += token[0].length;
		let value = `$${token[0]}`,
			capture = false;
		if (token[0] === "$") value = "$";
		else if (token[0] === "&") {
			value = source.slice(match.from, match.to);
			capture = true;
		} else if (token[0] === "`") value = source.slice(0, match.from);
		else if (token[0] === "'") value = source.slice(match.to);
		else if (token[2] !== undefined && match.groups) {
			value = match.groups[token[2]] ?? "";
			capture = true;
		} else {
			const number = Number(token[0]),
				first = Number(token[0][0]);
			if (number >= 1 && number <= captures.length) {
				value = captures[number - 1] ?? "";
				capture = true;
			} else if (
				token[0].length === 2 &&
				first >= 1 &&
				first <= captures.length
			) {
				value = (captures[first - 1] ?? "") + token[0][1];
				capture = true;
			}
		}
		append(capture ? captureCase(value, operations) : value);
		if (capture) operations.length = 0;
	}
	return pieces.join("");
}
