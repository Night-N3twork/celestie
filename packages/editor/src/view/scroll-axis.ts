export const maximumScrollExtent = 8000000;

export class ScrollAxis {
	private logical = 0;
	private native = 0;
	private logicalRange = 0;
	private nativeRange = 0;
	extent = 0;
	configure(size: number, viewport: number): void {
		this.extent = Math.min(maximumScrollExtent, size);
		this.logicalRange = Math.max(0, size - viewport);
		this.nativeRange = Math.max(0, this.extent - viewport);
	}
	get compressed(): boolean {
		return this.logicalRange > this.nativeRange;
	}
	read(native: number): number {
		if (native !== this.native) {
			this.native = native;
			this.logical = this.nativeRange
				? (native / this.nativeRange) * this.logicalRange
				: 0;
		}
		return this.logical;
	}
	write(value: number, assign: (native: number) => number): void {
		this.logical = Math.max(0, Math.min(this.logicalRange, value));
		this.native = assign(
			this.logicalRange
				? (this.logical / this.logicalRange) * this.nativeRange
				: 0,
		);
	}
}
