export {
	registerCommentShortcuts,
	registerEverydayShortcuts,
	registerLineShortcuts,
} from "./default-shortcuts";

import type { Disposable } from "../api/types";

export interface KeyboardShortcut {
	readonly id: string;
	readonly key: string;
	readonly primary?: boolean;
	readonly ctrl?: boolean;
	readonly meta?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly when?: () => boolean;
	readonly run: () => void;
	readonly chord?: readonly Omit<
		KeyboardShortcut,
		"id" | "run" | "when" | "chord"
	>[];
}

interface EditorShortcutCommands {
	readonly indent: () => void;
	readonly outdent: () => void;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly isComposing: () => boolean;
	readonly breakHistoryGroup: () => void;
	readonly announce?: (message: string) => void;
	readonly isReadOnly?: () => boolean;
}

export class KeyboardShortcuts implements Disposable {
	private readonly bindings: KeyboardShortcut[] = [];
	private readonly scopes = new Set<Disposable>();
	private releaseTabFocus = false;
	private disposed = false;
	private tabFocusMode = false;
	private pendingChord:
		| { bindings: readonly KeyboardShortcut[]; index: number }
		| undefined;
	private chordTimer: ReturnType<typeof setTimeout> | undefined;

	setTabFocusMode(enabled: boolean): void {
		this.tabFocusMode = enabled;
		this.cancelChord();
	}

	consumeClipboardChord(key: string): boolean {
		const pending = this.pendingChord;
		if (!pending) return false;
		const candidates = pending.bindings.filter((binding) => {
			const stroke = binding.chord?.[pending.index];
			return (
				stroke?.key.toLowerCase() === key &&
				(stroke.primary || stroke.ctrl || stroke.meta) &&
				!stroke.alt &&
				!stroke.shift &&
				(binding.when?.() ?? true)
			);
		});
		const match = candidates.at(-1);
		if (!match) return false;
		this.cancelChord();
		if (pending.index + 1 === match.chord?.length) {
			this.commands.announce?.("");
			match.run();
		} else this.beginChord(candidates, pending.index + 1);
		return true;
	}
	private cancelChord(): void {
		this.pendingChord = undefined;
		if (this.chordTimer !== undefined) clearTimeout(this.chordTimer);
	}

	constructor(
		private readonly target: HTMLElement,
		private readonly commands: EditorShortcutCommands,
	) {
		this.register({
			id: "editor.indent",
			key: "Tab",
			run: commands.indent,
		});
		this.register({
			id: "editor.outdent",
			key: "Tab",
			shift: true,
			run: commands.outdent,
		});
		this.register({
			id: "editor.undo",
			key: "z",
			primary: true,
			run: commands.undo,
		});
		this.register({
			id: "editor.redo",
			key: "z",
			primary: true,
			shift: true,
			run: commands.redo,
		});
		this.register({
			id: "editor.redoWindows",
			key: "y",
			ctrl: true,
			run: commands.redo,
		});
		target.addEventListener("keydown", this.handleKeyDown);
		target.addEventListener("blur", this.reset);
		target.addEventListener("pointerdown", this.reset);
	}

	register(binding: KeyboardShortcut): Disposable {
		if (this.disposed) throw new Error("Keyboard shortcuts disposed.");
		if (this.bindings.some((existing) => existing.id === binding.id))
			throw new Error(`Duplicate shortcut: ${binding.id}`);
		const registered = Object.freeze({
			...binding,
			...(binding.chord
				? {
						chord: Object.freeze(
							binding.chord.map((stroke) =>
								Object.freeze({ ...stroke }),
							),
						),
					}
				: {}),
		});
		this.bindings.push(registered);
		return {
			dispose: () => {
				if (this.pendingChord?.bindings.includes(registered))
					this.cancelChord();
				const index = this.bindings.indexOf(registered);
				if (index !== -1) this.bindings.splice(index, 1);
			},
		};
	}

	registerScope(
		target: HTMLElement,
		bindings: readonly KeyboardShortcut[],
	): Disposable {
		if (this.disposed) throw new Error("Keyboard shortcuts disposed.");
		const listener = (event: KeyboardEvent): void => {
			if (!event.defaultPrevented && !event.isComposing)
				this.execute(event, bindings);
		};
		target.addEventListener("keydown", listener);
		const scope = {
			dispose: () => {
				if (
					this.pendingChord?.bindings.some((binding) =>
						bindings.includes(binding),
					)
				)
					this.cancelChord();
				target.removeEventListener("keydown", listener);
				this.scopes.delete(scope);
			},
		};
		this.scopes.add(scope);
		return scope;
	}

	private readonly reset = (): void => {
		this.cancelChord();
		this.releaseTabFocus = false;
		this.commands.breakHistoryGroup();
	};

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			this.commands.isComposing()
		)
			return;
		if (event.key === "Escape") {
			if (this.pendingChord) {
				this.cancelChord();
				event.preventDefault();
				this.commands.announce?.("Key chord canceled.");
				return;
			}
			if (this.execute(event, this.bindings)) return;
			this.releaseTabFocus = true;
			this.commands.breakHistoryGroup();
			return;
		}
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
		if (
			this.commands.isReadOnly?.() &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			(event.key.length === 1 ||
				["Backspace", "Delete", "Enter"].includes(event.key))
		) {
			event.preventDefault();
			this.commands.announce?.("Editor is read-only.");
			return;
		}
		if (this.pendingChord) {
			const pending = this.pendingChord;
			const candidates = pending.bindings.filter((binding) => {
				const stroke = binding.chord?.[pending.index];
				return (
					stroke &&
					this.matches(stroke, event) &&
					(binding.when?.() ?? true)
				);
			});
			this.cancelChord();
			const match = candidates.at(-1);
			if (match) {
				event.preventDefault();
				if (pending.index + 1 === match.chord?.length) {
					this.commands.announce?.("");
					match.run();
				} else this.beginChord(candidates, pending.index + 1);
				return;
			}
			this.commands.announce?.("Key chord canceled.");
		}
		if (
			event.key === "Tab" &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			(this.releaseTabFocus || this.tabFocusMode)
		) {
			this.releaseTabFocus = false;
			return;
		}
		this.releaseTabFocus = false;
		if (
			[
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"Home",
				"End",
				"PageUp",
				"PageDown",
			].includes(event.key)
		) {
			this.commands.breakHistoryGroup();
		}
		this.execute(event, this.bindings);
	};

	private execute(
		event: KeyboardEvent,
		bindings: readonly KeyboardShortcut[],
	): boolean {
		for (let index = bindings.length - 1; index >= 0; index--) {
			const binding = bindings[index];
			if (
				!binding ||
				!this.matches(binding, event) ||
				(binding.when && !binding.when())
			)
				continue;
			event.preventDefault();
			if (binding.chord?.length)
				this.beginChord(
					bindings.filter(
						(entry) =>
							entry.chord?.length &&
							this.matches(entry, event) &&
							(entry.when?.() ?? true),
					),
					0,
				);
			else binding.run();
			return true;
		}
		return false;
	}

	private beginChord(
		bindings: readonly KeyboardShortcut[],
		index: number,
	): void {
		this.cancelChord();
		this.pendingChord = { bindings, index };
		this.commands.breakHistoryGroup();
		this.commands.announce?.("Waiting for the next key… Escape cancels.");
		this.chordTimer = setTimeout(() => {
			this.pendingChord = undefined;
			this.commands.announce?.("Key chord timed out.");
		}, 2000);
	}

	private matches(
		binding: Pick<
			KeyboardShortcut,
			"key" | "primary" | "ctrl" | "meta" | "alt" | "shift"
		>,
		event: KeyboardEvent,
	): boolean {
		if (binding.key.toLowerCase() !== event.key.toLowerCase()) return false;
		if (
			event.shiftKey !== (binding.shift ?? false) ||
			event.altKey !== (binding.alt ?? false)
		)
			return false;
		if (binding.primary) return event.ctrlKey !== event.metaKey;
		return (
			event.ctrlKey === (binding.ctrl ?? false) &&
			event.metaKey === (binding.meta ?? false)
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelChord();
		this.target.removeEventListener("keydown", this.handleKeyDown);
		this.target.removeEventListener("blur", this.reset);
		this.target.removeEventListener("pointerdown", this.reset);
		this.bindings.length = 0;
		for (const scope of [...this.scopes]) scope.dispose();
	}
}
