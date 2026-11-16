import type { TextSelection } from "../api/types";
import { wordRange } from "./editing-commands";
import { selectionLimit } from "./selections";

interface Host {
	text(): string;
	wordPattern(): RegExp;
	selections(): readonly TextSelection[];
	select(values: readonly TextSelection[]): void;
	announce(message: string): void;
}

export class OccurrenceSelection {
	private session:
		| { text: string; key: string; wholeWord: boolean }
		| undefined;
	constructor(private readonly host: Host) {}
	clear(): void {
		this.session = undefined;
	}
	select(all: boolean): void {
		const text = this.host.text(),
			pattern = this.host.wordPattern();
		const selections = [...this.host.selections()];
		const primary = selections[0];
		if (!primary) return;
		let wholeWord =
			this.session?.text === text &&
			this.session.key === JSON.stringify(selections) &&
			this.session.wholeWord;
		if (primary.start === primary.end) {
			const range = wordRange(text, primary.start, pattern);
			if (range.from === range.to) return;
			selections[0] = {
				start: range.from,
				end: range.to,
				direction: "forward",
			};
			wholeWord = true;
			if (!all) {
				this.save(text, selections, wholeWord);
				return;
			}
		}
		const selection = selections[0];
		if (!selection) return;
		const needle = text.slice(selection.start, selection.end);
		if (!needle) return;
		const values = all ? [selection] : selections;
		const start = all ? 0 : (values.at(-1)?.end ?? selection.end);
		let lineStart = -1,
			lineEnd = -1;
		let wordStarts = new Set<number>();
		const wholeMatch = (offset: number) => {
			if (offset < lineStart || offset > lineEnd) {
				lineStart =
					offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
				const newline = text.indexOf("\n", offset);
				lineEnd = newline < 0 ? text.length : newline;
				const expression = new RegExp(
					pattern.source,
					`${pattern.flags.replace(/[gy]/g, "")}g`,
				);
				wordStarts = new Set<number>();
				for (const match of text
					.slice(lineStart, lineEnd)
					.matchAll(expression))
					if (match[0] === needle)
						wordStarts.add(lineStart + match.index);
			}
			return wordStarts.has(offset);
		};
		const find = (from: number, to: number) => {
			let offset = from;
			while (offset <= to && values.length < selectionLimit) {
				const match = text.indexOf(needle, offset),
					end = match + needle.length;
				if (match < 0 || end > to) break;
				if (
					(!wholeWord || wholeMatch(match)) &&
					!values.some(
						(value) => match < value.end && end > value.start,
					)
				) {
					values.push({ start: match, end, direction: "forward" });
					if (!all) return true;
				}
				offset = end;
			}
			return false;
		};
		if (!find(start, text.length) && !all) find(0, start);
		this.save(text, values, wholeWord);
		this.host.announce(
			`${this.host.selections().length} selections${values.length === selectionLimit ? " (selection limit reached)" : ""}.`,
		);
	}
	private save(
		text: string,
		values: readonly TextSelection[],
		wholeWord: boolean,
	): void {
		this.host.select(values);
		this.session = {
			text,
			key: JSON.stringify(this.host.selections()),
			wholeWord,
		};
	}
}
