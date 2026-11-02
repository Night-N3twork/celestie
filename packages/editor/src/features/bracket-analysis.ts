import type { LanguageConfiguration } from "../languages/configuration";

type Context =
	| "code"
	| "string"
	| "template"
	| "line-comment"
	| "block-comment"
	| "regex";
interface Span {
	from: number;
	to: number;
	kind: Exclude<Context, "code">;
	closed: boolean;
}

export class BracketAnalysis {
	private readonly spans: Span[] = [];
	private readonly partners = new Map<number, number>();
	private readonly brackets = new Set<number>();
	private readonly quoteEnds = new Set<number>();
	private readonly openings: { offset: number; close: string }[] = [];

	constructor(
		readonly text: string,
		configuration: LanguageConfiguration,
	) {
		const opens = new Map(configuration.brackets);
		const closes = new Map(
			configuration.brackets.map(([open, close]) => [close, open]),
		);
		const stack: {
			offset: number;
			close: string;
			interpolation: boolean;
		}[] = [];
		let templateStart: number | undefined;
		let regexAllowed = true;
		let offset = 0;
		while (offset < text.length) {
			const character = text[offset] ?? "";
			if (templateStart !== undefined) {
				if (character === "\\") {
					offset += 2;
					continue;
				}
				if (character === configuration.templateQuote) {
					this.spans.push({
						from: templateStart,
						to: offset + 1,
						kind: "template",
						closed: true,
					});
					this.quoteEnds.add(offset);
					templateStart = undefined;
					regexAllowed = false;
				} else if (text.startsWith("${", offset)) {
					this.spans.push({
						from: templateStart,
						to: offset + 1,
						kind: "template",
						closed: true,
					});
					stack.push({
						offset: offset + 1,
						close: "}",
						interpolation: true,
					});
					this.brackets.add(offset + 1);
					this.openings.push({ offset: offset + 1, close: "}" });
					templateStart = undefined;
					regexAllowed = true;
					offset += 2;
					continue;
				}
				offset++;
				continue;
			}
			if (/\s/u.test(character)) {
				offset++;
				continue;
			}
			if (
				configuration.lineComment &&
				text.startsWith(configuration.lineComment, offset)
			) {
				const end = text.indexOf("\n", offset);
				const to = end === -1 ? text.length : end;
				this.spans.push({
					from: offset,
					to,
					kind: "line-comment",
					closed: false,
				});
				offset = to;
				continue;
			}
			const block = configuration.blockComment;
			if (block && text.startsWith(block[0], offset)) {
				const end = text.indexOf(block[1], offset + block[0].length);
				const to = end === -1 ? text.length : end + block[1].length;
				this.spans.push({
					from: offset,
					to,
					kind: "block-comment",
					closed: end !== -1,
				});
				offset = to;
				continue;
			}
			if (character === configuration.templateQuote) {
				templateStart = offset++;
				continue;
			}
			if (configuration.quotes.includes(character)) {
				const from = offset++;
				let closed = false;
				while (offset < text.length && text[offset] !== "\n") {
					if (text[offset] === "\\") {
						offset += 2;
						continue;
					}
					if (text[offset++] === character) {
						closed = true;
						break;
					}
				}
				this.spans.push({
					from,
					to: Math.min(offset, text.length),
					kind: "string",
					closed,
				});
				if (closed) this.quoteEnds.add(offset - 1);
				regexAllowed = false;
				continue;
			}
			if (
				configuration.regexLiterals &&
				character === "/" &&
				text[offset + 1] !== "=" &&
				regexAllowed
			) {
				const from = offset++;
				let characterClass = false;
				let closed = false;
				while (offset < text.length && text[offset] !== "\n") {
					const unit = text[offset++];
					if (unit === "\\") {
						offset++;
						continue;
					}
					if (unit === "[") characterClass = true;
					if (unit === "]") characterClass = false;
					if (unit === "/" && !characterClass) {
						closed = true;
						break;
					}
				}
				this.spans.push({
					from,
					to: Math.min(offset, text.length),
					kind: "regex",
					closed,
				});
				regexAllowed = false;
				continue;
			}
			const close = opens.get(character);
			if (close) {
				this.openings.push({ offset, close });
				stack.push({ offset, close, interpolation: false });
				this.brackets.add(offset);
				regexAllowed = true;
			} else if (closes.has(character)) {
				this.brackets.add(offset);
				const open = stack.at(-1);
				if (open?.close === character) {
					stack.pop();
					this.partners.set(offset, open.offset);
					this.partners.set(open.offset, offset);
					if (open.interpolation) templateStart = offset;
				} else {
					stack.length = 0;
				}
				regexAllowed = false;
			} else if (/[\p{ID_Continue}$]/u.test(character)) {
				const from = offset++;
				while (
					offset < text.length &&
					/[\p{ID_Continue}$]/u.test(text[offset] ?? "")
				)
					offset++;
				regexAllowed =
					/^(return|throw|case|delete|typeof|void|yield|await|in|of|instanceof|new)$/.test(
						text.slice(from, offset),
					);
				continue;
			} else {
				regexAllowed = !".++--".includes(character);
			}
			offset++;
		}
		if (templateStart !== undefined)
			this.spans.push({
				from: templateStart,
				to: text.length,
				kind: "template",
				closed: false,
			});
	}

	contextAt(offset: number): Context {
		let low = 0;
		let high = this.spans.length - 1;
		while (low <= high) {
			const middle = (low + high) >>> 1;
			const span = this.spans[middle];
			if (!span) break;
			if (offset <= span.from) high = middle - 1;
			else if (offset > span.to || (offset === span.to && span.closed))
				low = middle + 1;
			else return span.kind;
		}
		return "code";
	}

	isBracket(offset: number): boolean {
		return this.brackets.has(offset);
	}
	blockCommentAt(offset: number): Readonly<Span> | undefined {
		return this.spans.find(
			(span) =>
				span.kind === "block-comment" &&
				span.from <= offset &&
				(offset < span.to || (!span.closed && offset === span.to)),
		);
	}
	isQuoteEnd(offset: number): boolean {
		return this.quoteEnds.has(offset);
	}
	partner(offset: number): number | undefined {
		return this.partners.get(offset);
	}

	openingBefore(offset: number, close: string): number | undefined {
		for (let index = this.openings.length - 1; index >= 0; index--) {
			const open = this.openings[index];
			if (
				open &&
				open.offset < offset &&
				open.close === close &&
				(this.partner(open.offset) ?? this.text.length) >= offset
			)
				return open.offset;
		}
		return undefined;
	}

	matchingAt(offset: number): readonly number[] {
		for (const candidate of [offset, offset - 1]) {
			const partner = this.partner(candidate);
			if (partner !== undefined) return [candidate, partner];
		}
		return [];
	}
}
