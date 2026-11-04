export interface SnippetTabstop {
	readonly index: number;
	readonly from: number;
	readonly to: number;
	readonly choices?: readonly string[];
}
export interface ParsedSnippet {
	readonly text: string;
	readonly stops: readonly SnippetTabstop[];
}
export function transformSnippet(value: string, body: string): string {
	const sections: string[] = [];
	let part = "",
		depth = 0;
	for (let index = 1; index < body.length; index++) {
		const char = body[index] ?? "";
		if (char === "\\") {
			part += char + (body[++index] ?? "");
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") depth--;
		if (char === "/" && depth === 0) {
			sections.push(part);
			part = "";
		} else part += char;
	}
	sections.push(part);
	try {
		return value.replace(
			new RegExp(sections[0] ?? "", sections[2] ?? ""),
			(...args: unknown[]) => {
				const format = sections[1] ?? "";
				return format.replace(
					/\$(\d+)|\$\{(\d+)(?::([^}]*))?\}/g,
					(
						_match,
						plain: string | undefined,
						nested: string | undefined,
						operation: string | undefined,
					) => {
						const capture = String(
							args[Number(plain ?? nested)] ?? "",
						);
						if (!operation) return capture;
						if (operation === "/upcase")
							return capture.toUpperCase();
						if (operation === "/downcase")
							return capture.toLowerCase();
						if (operation === "/capitalize")
							return (
								capture.charAt(0).toUpperCase() +
								capture.slice(1)
							);
						if (
							operation === "/camelcase" ||
							operation === "/pascalcase"
						) {
							const words = capture
								.split(/[^\p{L}\p{N}]+/u)
								.filter(Boolean);
							return words
								.map((word, index) =>
									index === 0 && operation === "/camelcase"
										? word.charAt(0).toLowerCase() +
											word.slice(1)
										: word.charAt(0).toUpperCase() +
											word.slice(1),
								)
								.join("");
						}
						if (operation.startsWith("+"))
							return capture ? operation.slice(1) : "";
						if (operation.startsWith("-"))
							return capture || operation.slice(1);
						if (operation.startsWith("?")) {
							const [yes, no] = operation.slice(1).split(":");
							return capture ? (yes ?? "") : (no ?? "");
						}
						return capture || operation;
					},
				);
			},
		);
	} catch {
		return value;
	}
}
export function parseSnippet(
	source: string,
	variables: Readonly<Record<string, string>> = {},
): ParsedSnippet {
	let text = "";
	const stops: SnippetTabstop[] = [],
		values = new Map<string, string>();
	const render = (input: string, base: number): string => {
		let out = "";
		for (let i = 0; i < input.length; ) {
			const ch = input[i];
			if (ch === "\\" && i + 1 < input.length) {
				out += input[i + 1];
				i += 2;
				continue;
			}
			if (ch !== "$") {
				out += ch;
				i++;
				continue;
			}
			let key = "",
				body = "",
				kind = "";
			const opening = i;
			i++;
			if (input[i] === "{") {
				let depth = 1,
					j = ++i;
				for (; j < input.length && depth; j++) {
					if (input[j] === "\\") {
						j++;
						continue;
					}
					if (input[j] === "{") depth++;
					if (input[j] === "}") depth--;
				}
				const expression = input.slice(i, j - 1),
					match = expression.match(/^(\w+)([\s\S]*)$/);
				key = match?.[1] ?? "";
				body = match?.[2] ?? "";
				kind = body[0] ?? "";
				i = j;
			} else {
				const match = input.slice(i).match(/^(\d+|[A-Za-z_]\w*)/);
				key = match?.[0] ?? "";
				i += key.length;
			}
			if (!key) {
				out += input.slice(opening, i);
				continue;
			}
			let value = values.get(key) ?? variables[key] ?? "";
			if (kind === ":" && !value)
				value = render(body.slice(1), base + out.length);
			else if (kind === "|")
				value =
					body
						.slice(1, -1)
						.split(/(?<!\\),/)[0]
						?.replace(/\\,/g, ",") ?? "";
			else if (kind === "/") value = transformSnippet(value, body);
			if (kind !== "/") values.set(key, value);
			const from = base + out.length;
			out += value;
			if (/^\d+$/.test(key) && kind !== "/")
				stops.push({
					index: Number(key),
					from,
					to: from + value.length,
					...(kind === "|"
						? {
								choices: body
									.slice(1, -1)
									.split(/(?<!\\),/)
									.map((value) => value.replace(/\\,/g, ",")),
							}
						: {}),
				});
		}
		return out;
	};
	render(source, 0);
	stops.length = 0;
	text = render(source, 0);
	stops.sort(
		(a, b) =>
			(a.index === 0 ? Infinity : a.index) -
				(b.index === 0 ? Infinity : b.index) || a.from - b.from,
	);
	return { text, stops };
}
