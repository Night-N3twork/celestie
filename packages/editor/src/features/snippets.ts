export interface SnippetTabstop {
	readonly index: number;
	readonly from: number;
	readonly to: number;
	readonly choices?: readonly string[];
	readonly parents: readonly number[];
	readonly order: number;
}
export interface ParsedSnippet {
	readonly text: string;
	readonly stops: readonly SnippetTabstop[];
	readonly transforms: readonly (SnippetTabstop & {
		readonly transform: string;
	})[];
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
				const captures =
					args.length - (typeof args.at(-1) === "object" ? 3 : 2);
				return format.replace(
					/\$(\d+)|\$\{(\d+)(?::([^}]*))?\}/g,
					(
						_match,
						plain: string | undefined,
						nested: string | undefined,
						operation: string | undefined,
					) => {
						const index = Number(plain ?? nested);
						const capture =
							index < captures ? String(args[index] ?? "") : "";
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
							return capture ? "" : operation.slice(1);
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

interface SnippetNode {
	readonly key: string;
	readonly kind: string;
	readonly body: string;
	readonly children: readonly (string | SnippetNode)[];
}
function snippetNodes(input: string): (string | SnippetNode)[] {
	const nodes: (string | SnippetNode)[] = [];
	let literal = "";
	const flush = () => {
		if (literal) nodes.push(literal);
		literal = "";
	};
	for (let i = 0; i < input.length; ) {
		if (input[i] === "\\" && i + 1 < input.length) {
			literal += input[i + 1];
			i += 2;
			continue;
		}
		if (input[i] !== "$") {
			literal += input[i++];
			continue;
		}
		const opening = i++;
		let expression = "";
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
			if (depth) {
				literal += input.slice(opening);
				break;
			}
			expression = input.slice(i, j - 1);
			i = j;
		} else {
			expression = input.slice(i).match(/^(\d+|[A-Za-z_]\w*)/)?.[0] ?? "";
			i += expression.length;
		}
		const match = expression.match(/^(\w+)([\s\S]*)$/),
			key = match?.[1] ?? "",
			body = match?.[2] ?? "",
			kind = body[0] ?? "";
		if (!key || (kind && ![":", "|", "/"].includes(kind))) {
			literal += input.slice(opening, i);
			continue;
		}
		flush();
		nodes.push({
			key,
			body,
			kind,
			children: kind === ":" ? snippetNodes(body.slice(1)) : [],
		});
	}
	flush();
	return nodes;
}
export function parseSnippet(
	source: string,
	variables: Readonly<Record<string, string>> = {},
): ParsedSnippet {
	const nodes = snippetNodes(source),
		definitions = new Map<string, SnippetNode>(),
		stops: SnippetTabstop[] = [],
		transforms: (SnippetTabstop & { transform: string })[] = [];
	const collect = (nodes: readonly (string | SnippetNode)[]) => {
		for (const node of nodes) {
			if (typeof node === "string") continue;
			if (
				/^\d+$/.test(node.key) &&
				node.kind !== "/" &&
				(!definitions.has(node.key) ||
					(!definitions.get(node.key)?.kind && node.kind))
			)
				definitions.set(node.key, node);
			collect(node.children);
		}
	};
	collect(nodes);
	const choices = (node: SnippetNode) =>
		node.body
			.slice(1, -1)
			.split(/(?<!\\),/)
			.map((value) => value.replace(/\\([,|\\])/g, "$1"));
	let order = 0;
	const render = (
		nodes: readonly (string | SnippetNode)[],
		base: number,
		parents: readonly number[],
		emit: boolean,
		visiting: ReadonlySet<string>,
	): string => {
		let text = "";
		for (const node of nodes) {
			if (typeof node === "string") {
				text += node;
				continue;
			}
			const numeric = /^\d+$/.test(node.key),
				index = Number(node.key),
				definition = numeric ? definitions.get(node.key) : node;
			let value = "";
			const from = base + text.length,
				ordinal = order++;
			if (!numeric && variables[node.key] !== undefined)
				value = variables[node.key] ?? "";
			else if (!visiting.has(node.key)) {
				const next = new Set(visiting);
				next.add(node.key);
				if (definition?.kind === ":")
					value = render(
						definition.children,
						from,
						numeric ? [...parents, index] : parents,
						emit && node.kind !== "/",
						next,
					);
				else if (definition?.kind === "|")
					value = choices(definition)[0] ?? "";
			}
			if (node.kind === "/") value = transformSnippet(value, node.body);
			text += value;
			if (emit && numeric) {
				const stop = {
					index,
					from,
					to: from + value.length,
					parents,
					order: ordinal,
					...(definition?.kind === "|"
						? { choices: choices(definition) }
						: {}),
				};
				if (node.kind === "/")
					transforms.push({ ...stop, transform: node.body });
				else stops.push(stop);
			}
		}
		return text;
	};
	const text = render(nodes, 0, [], true, new Set());
	stops.sort(
		(a, b) =>
			(a.index === 0 ? Infinity : a.index) -
				(b.index === 0 ? Infinity : b.index) || a.from - b.from,
	);
	return { text, stops, transforms };
}
