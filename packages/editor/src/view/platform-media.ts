import type { Disposable } from "../api/types";

export type PlatformMediaChange = "resolution" | "appearance";
export class PlatformMedia implements Disposable {
	private resolution: MediaQueryList | undefined;
	private readonly appearance: MediaQueryList[] = [];
	private disposed = false;
	constructor(
		private readonly view: Window | null,
		private readonly changed: (kind: PlatformMediaChange) => void,
	) {
		this.lastRatio = this.devicePixelRatio;
		if (!view?.matchMedia) return;
		for (const query of [
			"(prefers-color-scheme: dark)",
			"(prefers-contrast: more)",
			"(forced-colors: active)",
		]) {
			const list = view.matchMedia(query);
			list.addEventListener("change", this.appearanceChanged);
			this.appearance.push(list);
		}
		this.watchResolution();
		view.addEventListener("resize", this.resized);
	}
	private lastRatio = 1;
	private readonly resized = (): void => {
		if (this.devicePixelRatio !== this.lastRatio) this.resolutionChanged();
	};
	get devicePixelRatio(): number {
		return this.view?.devicePixelRatio || 1;
	}
	private readonly appearanceChanged = (): void => {
		if (!this.disposed) this.changed("appearance");
	};
	private readonly resolutionChanged = (): void => {
		if (this.disposed || this.devicePixelRatio === this.lastRatio) return;
		this.lastRatio = this.devicePixelRatio;
		this.watchResolution();
		this.changed("resolution");
	};
	private watchResolution(): void {
		this.resolution?.removeEventListener("change", this.resolutionChanged);
		this.resolution = this.view?.matchMedia(
			`(resolution: ${this.devicePixelRatio}dppx)`,
		);
		this.resolution?.addEventListener("change", this.resolutionChanged);
	}
	dispose(): void {
		this.disposed = true;
		this.view?.removeEventListener("resize", this.resized);
		this.resolution?.removeEventListener("change", this.resolutionChanged);
		for (const list of this.appearance)
			list.removeEventListener("change", this.appearanceChanged);
		this.appearance.length = 0;
	}
}
