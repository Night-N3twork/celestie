import type { TextSelection } from "../api/types";
import type { EditingPlan, InputEdit } from "./editing-plan";

export interface IndentationOptions {
	readonly tabSize: number;
	readonly insertSpaces: boolean;
}

export const defaultIndentation: IndentationOptions = {
	tabSize: 4,
	insertSpaces: false,
};

export function resolveIndentation(
	options: Partial<IndentationOptions>,
	fallback = defaultIndentation,
): IndentationOptions {
	const value = {
		tabSize:
			options.tabSize === undefined ? fallback.tabSize : options.tabSize,
		insertSpaces:
			options.insertSpaces === undefined
				? fallback.insertSpaces
				: options.insertSpaces,
	};
	if (
		!Number.isInteger(value.tabSize) ||
		value.tabSize < 1 ||
		value.tabSize > 16
	)
		throw new RangeError("Tab size must be an integer between 1 and 16.");
	if (typeof value.insertSpaces !== "boolean")
		throw new TypeError("insertSpaces must be a boolean.");
	return Object.freeze(value);
}

export function indentationWidth(text: string, tabSize: number): number {
	let column = 0;
	for (const unit of text)
		column += unit === "\t" ? tabSize - (column % tabSize) : 1;
	return column;
}

export function indentationText(
	width: number,
	options: IndentationOptions,
): string {
	return options.insertSpaces
		? " ".repeat(width)
		: "\t".repeat(Math.floor(width / options.tabSize)) +
				" ".repeat(width % options.tabSize);
}

export function indentationUnit(options: IndentationOptions): string {
	return options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
}

export function detectIndentation(
	text: string,
	fallback: IndentationOptions,
): IndentationOptions {
	let tabs = 0;
	const spaces: number[] = [];
	for (const line of text.split("\n").slice(0, 2000)) {
		if (!line.trim()) continue;
		const prefix = line.match(/^[\t ]*/)?.[0] ?? "";
		if (prefix.includes("\t")) tabs++;
		else if (prefix.length) spaces.push(prefix.length);
	}
	if (!tabs && !spaces.length) return fallback;
	if (tabs > spaces.length)
		return resolveIndentation({ insertSpaces: false }, fallback);
	const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
	const size = spaces.reduce(gcd, 0);
	return resolveIndentation(
		{
			insertSpaces: true,
			tabSize: size >= 1 && size <= 8 ? size : fallback.tabSize,
		},
		fallback,
	);
}

export function planIndentationConversion(
	text: string,
	selection: TextSelection,
	options: IndentationOptions,
): EditingPlan {
	const edits: InputEdit[] = [];
	let from = 0;
	for (const line of text.split("\n")) {
		const prefix = line.match(/^[\t ]*/)?.[0] ?? "";
		const replacement = indentationText(
			indentationWidth(prefix, options.tabSize),
			options,
		);
		if (prefix !== replacement)
			edits.push({ from, to: from + prefix.length, text: replacement });
		from += line.length + 1;
	}
	const map = (offset: number): number => {
		let delta = 0;
		for (const edit of edits) {
			if (offset < edit.from) break;
			if (offset <= edit.to) {
				const width = indentationWidth(
					text.slice(edit.from, offset),
					options.tabSize,
				);
				let units = 0;
				let column = 0;
				while (units < edit.text.length) {
					const next =
						column +
						(edit.text[units] === "\t"
							? options.tabSize - (column % options.tabSize)
							: 1);
					if (next > width) break;
					column = next;
					units++;
				}
				return edit.from + delta + units;
			}
			delta += edit.text.length - (edit.to - edit.from);
		}
		return offset + delta;
	};
	return {
		edits,
		selection: {
			...selection,
			start: map(selection.start),
			end: map(selection.end),
		},
	};
}
