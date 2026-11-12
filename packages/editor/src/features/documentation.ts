import type { Documentation } from "../api/language-contributions";

export function safeLink(target: string): boolean {
	return (
		/^(https?:|mailto:)/i.test(target) &&
		![...target].some((character) => character.charCodeAt(0) <= 32)
	);
}
export function renderDocumentation(
	doc: Document,
	content: Documentation,
	open?: (target: string) => void,
): HTMLElement {
	const root = doc.createElement("div");
	root.className = "editor-documentation";
	if (typeof content === "string") {
		const pre = doc.createElement("pre");
		pre.textContent = content;
		root.append(pre);
		return root;
	}
	const inline = (parent: HTMLElement, text: string) => {
		const expression =
			/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
		let offset = 0;
		for (const match of text.matchAll(expression)) {
			parent.append(doc.createTextNode(text.slice(offset, match.index)));
			const value = match[0];
			if (value.startsWith("`")) {
				const node = doc.createElement("code");
				node.textContent = value.slice(1, -1);
				parent.append(node);
			} else if (value.startsWith("**")) {
				const node = doc.createElement("strong");
				node.textContent = value.slice(2, -2);
				parent.append(node);
			} else {
				const link = value.match(/^\[([^\]]+)\]\((.+)\)$/);
				if (link?.[1] && link[2] && safeLink(link[2])) {
					const a = doc.createElement("a");
					a.textContent = link[1];
					a.href = link[2];
					a.target = "_blank";
					a.rel = "noopener noreferrer";
					if (open)
						a.onclick = (event) => {
							event.preventDefault();
							open(link[2] ?? "");
						};
					parent.append(a);
				} else parent.append(doc.createTextNode(value));
			}
			offset = match.index + value.length;
		}
		parent.append(doc.createTextNode(text.slice(offset)));
	};
	let code: HTMLPreElement | undefined;
	for (const line of content.markdown.slice(0, 100000).split("\n")) {
		if (/^\s*```/.test(line)) {
			if (code) code = undefined;
			else {
				code = doc.createElement("pre");
				root.append(code);
			}
			continue;
		}
		if (code) {
			code.append(doc.createTextNode(`${line}\n`));
			continue;
		}
		const node = doc.createElement(/^[-*] /.test(line) ? "li" : "p");
		inline(node, line.replace(/^[-*] /, ""));
		root.append(node);
	}
	return root;
}
