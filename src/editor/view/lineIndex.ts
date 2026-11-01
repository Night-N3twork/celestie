export class LineIndex {
	readonly starts = [0];
	readonly ends: number[] = [];

	constructor(public text: string) {
		const endings = /\r\n|\r|\n/g;
		for (const match of text.matchAll(endings)) {
			this.ends.push(match.index);
			this.starts.push(match.index + match[0].length);
		}
		this.ends.push(text.length);
	}

	update(
		text: string,
		edit: { from: number; to: number; text: string },
	): LineIndex {
		const first = this.lineAt(Math.max(0, edit.from - 1));
		const end = Math.min(
			this.count,
			this.lineAt(Math.min(this.text.length, edit.to + 1)) + 1,
		);
		const from = this.starts[first];
		const to = this.starts[end] ?? this.text.length;
		const delta = edit.text.length - (edit.to - edit.from);
		const local = new LineIndex(text.slice(from, to + delta));
		const keep = end < this.count ? local.count - 1 : local.count;
		const starts = [
			...this.starts.slice(0, first),
			...local.starts.slice(0, keep).map((offset) => offset + from),
			...this.starts.slice(end).map((offset) => offset + delta),
		];
		const ends = [
			...this.ends.slice(0, first),
			...local.ends.slice(0, keep).map((offset) => offset + from),
			...this.ends.slice(end).map((offset) => offset + delta),
		];
		return Object.assign(Object.create(LineIndex.prototype) as LineIndex, {
			starts,
			ends,
			text,
		});
	}

	get count(): number {
		return this.starts.length;
	}
	line(index: number): string {
		return this.text.slice(this.starts[index], this.ends[index]);
	}

	lineAt(offset: number): number {
		let low = 0;
		let high = this.count;
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2);
			if (this.starts[middle] <= offset) low = middle;
			else high = middle;
		}
		return low;
	}
}
