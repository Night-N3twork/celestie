import { copyText } from "./text-utils";

const chunkSize = 4096;

interface Summary {
	readonly length: number;
	readonly breaks: number;
	readonly crlf: number;
	readonly firstLF: boolean;
	readonly lastCR: boolean;
	readonly height: number;
	readonly pieces: number;
}
interface Leaf extends Summary {
	readonly kind: "leaf";
	readonly text: string;
	readonly ends: readonly number[];
	readonly crlfEnds: readonly number[];
}
interface Branch extends Summary {
	readonly kind: "branch";
	readonly left: Node;
	readonly right: Node;
}
export type Node = Leaf | Branch;
export type Root = Node | undefined;

function leaf(text: string): Root {
	if (!text) return undefined;
	text = copyText(text);
	const ends: number[] = [];
	const crlfEnds: number[] = [];
	let crlf = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\r") {
			if (text[index + 1] === "\n") {
				index++;
				crlf++;
				crlfEnds.push(index + 1);
			}
			ends.push(index + 1);
		} else if (text[index] === "\n") ends.push(index + 1);
	}
	return {
		kind: "leaf",
		text,
		ends,
		crlfEnds,
		length: text.length,
		breaks: ends.length,
		crlf,
		firstLF: text[0] === "\n",
		lastCR: text.at(-1) === "\r",
		height: 1,
		pieces: 1,
	};
}

function branch(left: Node, right: Node): Branch {
	const cross = left.lastCR && right.firstLF ? 1 : 0;
	return {
		kind: "branch",
		left,
		right,
		length: left.length + right.length,
		breaks: left.breaks + right.breaks - cross,
		crlf: left.crlf + right.crlf + cross,
		firstLF: left.firstLF,
		lastCR: right.lastCR,
		height: Math.max(left.height, right.height) + 1,
		pieces: left.pieces + right.pieces,
	};
}

function balance(left: Node, right: Node): Node {
	if (left.height > right.height + 1 && left.kind === "branch") {
		if (left.left.height >= left.right.height)
			return branch(left.left, branch(left.right, right));
		if (left.right.kind === "branch")
			return branch(
				branch(left.left, left.right.left),
				branch(left.right.right, right),
			);
	}
	if (right.height > left.height + 1 && right.kind === "branch") {
		if (right.right.height >= right.left.height)
			return branch(branch(left, right.left), right.right);
		if (right.left.kind === "branch")
			return branch(
				branch(left, right.left.left),
				branch(right.left.right, right.right),
			);
	}
	return branch(left, right);
}

export function join(left: Root, right: Root): Root {
	if (!left) return right;
	if (!right) return left;
	if (
		left.kind === "leaf" &&
		right.kind === "leaf" &&
		left.length + right.length <= chunkSize
	)
		return leaf(left.text + right.text);
	if (left.height > right.height + 1 && left.kind === "branch")
		return balance(left.left, join(left.right, right) as Node);
	if (right.height > left.height + 1 && right.kind === "branch")
		return balance(join(left, right.left) as Node, right.right);
	return branch(left, right);
}

export function build(text: string): Root {
	const pieces: Node[] = [];
	for (let offset = 0; offset < text.length; offset += chunkSize)
		pieces.push(leaf(text.slice(offset, offset + chunkSize)) as Node);
	const assemble = (from: number, to: number): Root => {
		if (from >= to) return undefined;
		if (to - from === 1) return pieces[from];
		const middle = (from + to) >>> 1;
		return branch(
			assemble(from, middle) as Node,
			assemble(middle, to) as Node,
		);
	};
	return assemble(0, pieces.length);
}

export function split(root: Root, offset: number): readonly [Root, Root] {
	if (!root) return [undefined, undefined];
	if (offset <= 0) return [undefined, root];
	if (offset >= root.length) return [root, undefined];
	if (root.kind === "leaf")
		return [
			leaf(root.text.slice(0, offset)),
			leaf(root.text.slice(offset)),
		];
	if (offset < root.left.length) {
		const [a, b] = split(root.left, offset);
		return [a, join(b, root.right)];
	}
	const [a, b] = split(root.right, offset - root.left.length);
	return [join(root.left, a), b];
}

export function slice(root: Root, from: number, to: number): string {
	const parts: string[] = [];
	const visit = (node: Root, start: number, end: number): void => {
		if (!node || end <= start) return;
		if (node.kind === "leaf") {
			parts.push(node.text.slice(start, end));
			return;
		}
		if (start < node.left.length)
			visit(node.left, start, Math.min(end, node.left.length));
		if (end > node.left.length)
			visit(
				node.right,
				Math.max(0, start - node.left.length),
				end - node.left.length,
			);
	};
	visit(root, from, to);
	return parts.join("");
}

export function characterAt(root: Root, offset: number): string {
	if (!root || offset < 0 || offset >= root.length) return "";
	let node = root;
	let index = offset;
	while (node.kind === "branch") {
		if (index < node.left.length) node = node.left;
		else {
			index -= node.left.length;
			node = node.right;
		}
	}
	return node.text[index] ?? "";
}

export function breakEnd(root: Root, rank: number): number {
	if (!root || rank < 1 || rank > root.breaks)
		throw new RangeError("Line break is outside the document.");
	if (root.kind === "leaf") return root.ends[rank - 1] ?? root.length;
	const cross = root.left.lastCR && root.right.firstLF;
	if (cross && rank === root.left.breaks) return root.left.length + 1;
	if (rank <= root.left.breaks) return breakEnd(root.left, rank);
	return (
		root.left.length +
		breakEnd(root.right, rank - root.left.breaks + (cross ? 1 : 0))
	);
}

export function prefix(
	root: Root,
	length: number,
): { breaks: number; crlf: number; lastCR: boolean } {
	if (!root || length <= 0) return { breaks: 0, crlf: 0, lastCR: false };
	if (length >= root.length) return root;
	if (root.kind === "leaf") {
		const count = (values: readonly number[]): number => {
			let low = 0;
			let high = values.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if ((values[middle] ?? Infinity) <= length) low = middle + 1;
				else high = middle;
			}
			return low;
		};
		const breaks =
			count(root.ends) +
			(root.text[length - 1] === "\r" && root.text[length] === "\n"
				? 1
				: 0);
		const crlf = count(root.crlfEnds);
		return { breaks, crlf, lastCR: root.text[length - 1] === "\r" };
	}
	if (length <= root.left.length) return prefix(root.left, length);
	const right = prefix(root.right, length - root.left.length);
	const cross = root.left.lastCR && root.right.firstLF ? 1 : 0;
	return {
		breaks: root.left.breaks + right.breaks - cross,
		crlf: root.left.crlf + right.crlf + cross,
		lastCR: right.lastCR,
	};
}

export function snapshot(root: Root): {
	read(): string | null;
	dispose(): void;
} {
	const stack: Node[] = root ? [root] : [];
	let empty = !root;
	return {
		read: () => {
			if (empty) {
				empty = false;
				return "";
			}
			while (stack.length) {
				const node = stack.pop();
				if (!node) break;
				if (node.kind === "leaf") return node.text;
				stack.push(node.right, node.left);
			}
			return null;
		},
		dispose: () => {
			empty = false;
			stack.length = 0;
		},
	};
}
