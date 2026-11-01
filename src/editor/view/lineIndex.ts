export class LineIndex {
	readonly starts = [0];
	readonly ends: number[] = [];

	constructor(readonly text: string) {
		const endings = /\r\n|\r|\n/g;
		for (const match of text.matchAll(endings)) {
			this.ends.push(match.index);
			this.starts.push(match.index + match[0].length);
		}
		this.ends.push(text.length);
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
