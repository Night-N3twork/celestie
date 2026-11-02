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
}

interface EditorShortcutCommands {
	readonly indent: () => void;
	readonly outdent: () => void;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly isComposing: () => boolean;
	readonly breakHistoryGroup: () => void;
}

export class KeyboardShortcuts implements Disposable {
	private readonly bindings: KeyboardShortcut[] = [];
	private readonly scopes = new Set<Disposable>();
	private releaseTabFocus = false;
	private disposed = false;

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
		const registered = Object.freeze({ ...binding });
		this.bindings.push(registered);
		return {
			dispose: () => {
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
				target.removeEventListener("keydown", listener);
				this.scopes.delete(scope);
			},
		};
		this.scopes.add(scope);
		return scope;
	}

	private readonly reset = (): void => {
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
			if (this.execute(event, this.bindings)) return;
			this.releaseTabFocus = true;
			this.commands.breakHistoryGroup();
			return;
		}
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
		if (
			event.key === "Tab" &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			this.releaseTabFocus
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
			binding.run();
			return true;
		}
		return false;
	}

	private matches(binding: KeyboardShortcut, event: KeyboardEvent): boolean {
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
		this.target.removeEventListener("keydown", this.handleKeyDown);
		this.target.removeEventListener("blur", this.reset);
		this.target.removeEventListener("pointerdown", this.reset);
		this.bindings.length = 0;
		for (const scope of [...this.scopes]) scope.dispose();
	}
}
