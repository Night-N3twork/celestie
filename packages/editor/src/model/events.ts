import type { Disposable } from "../api/types";

export class Emitter<T> implements Disposable {
	private disposed = false;
	private readonly listeners = new Set<(event: T) => void>();
	constructor(
		private readonly reportError: (error: unknown) => void = console.error,
	) {}
	on(listener: (event: T) => void): Disposable {
		if (this.disposed) throw new Error("Event emitter disposed.");
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}
	emit(event: T): void {
		if (this.disposed) return;
		for (const listener of [...this.listeners]) {
			if (!this.listeners.has(listener)) continue;
			try {
				listener(event);
			} catch (error) {
				try {
					this.reportError(error);
				} catch {}
			}
		}
	}
	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}
}
