function regexEnd(source: string, start: number): number {
	let bracket = false;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (char === "[") bracket = true;
		else if (char === "]") bracket = false;
		else if (char === "/" && !bracket) return i;
	}
	return -1;
}
function templateEnd(
	source: string,
	start: number,
	delimiter: string,
	depth: number,
): number {
	for (let i = start; i < source.length; i++) {
		if (source[i] === "\\") {
			i++;
			continue;
		}
		if (source[i] === "$" && source[i + 1] === "{") {
			const end = snippetExpressionEnd(source, i, depth + 1);
			if (end < 0) return -1;
			i = end;
		} else if (source[i] === delimiter) return i;
	}
	return -1;
}
export function snippetExpressionEnd(
	source: string,
	start: number,
	depth = 0,
): number {
	if (depth > 64 || source.slice(start, start + 2) !== "${") return -1;
	const name = source.slice(start + 2).match(/^(?:\d+|[A-Za-z_]\w*)/)?.[0];
	if (!name) return templateEnd(source, start + 2, "}", depth);
	const at = start + 2 + name.length,
		kind = source[at];
	if (kind === "/") {
		const regex = regexEnd(source, at + 1);
		if (regex < 0) return -1;
		const format = templateEnd(source, regex + 1, "/", depth);
		return format < 0 ? -1 : source.indexOf("}", format + 1);
	}
	if (kind === "|") {
		for (let i = at + 1; i < source.length; i++) {
			if (source[i] === "\\") i++;
			else if (source[i] === "|" && source[i + 1] === "}") return i + 1;
		}
		return -1;
	}
	return templateEnd(source, kind === ":" ? at + 1 : at, "}", depth);
}
export function snippetTransformParts(
	body: string,
): readonly [string, string, string] | undefined {
	const regex = regexEnd(body, 1);
	if (regex < 0) return;
	const format = templateEnd(body, regex + 1, "/", 0);
	if (format < 0) return;
	return [
		body.slice(1, regex),
		body.slice(regex + 1, format),
		body.slice(format + 1),
	];
}
