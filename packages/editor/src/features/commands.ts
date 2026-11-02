import type { Disposable } from "../api/types";

export interface EditorCommand {
	readonly id: string;
	readonly label: string;
	readonly shortcut?: string;
	readonly menu?: boolean;
	readonly when?: () => boolean;
	readonly run: () => void | Promise<void>;
}

export class CommandRegistry implements Disposable {
	private readonly entries = new Map<string, EditorCommand>();
	private disposed = false;

	register(command: EditorCommand): Disposable {
		if (this.disposed) throw new Error("Commands disposed.");
		if (this.entries.has(command.id))
			throw new Error(`Duplicate command: ${command.id}`);
		const entry = Object.freeze({ ...command });
		this.entries.set(entry.id, entry);
		return {
			dispose: () => {
				if (this.entries.get(entry.id) === entry)
					this.entries.delete(entry.id);
			},
		};
	}

	list(): readonly EditorCommand[] {
		return [...this.entries.values()];
	}
	isEnabled(id: string): boolean {
		const entry = this.entries.get(id);
		try {
			return !!entry && !this.disposed && (entry.when?.() ?? true);
		} catch (error) {
			console.error("Editor command condition failed", error);
			return false;
		}
	}

	async execute(id: string): Promise<boolean> {
		if (this.disposed) throw new Error("Commands disposed.");
		const entry = this.entries.get(id);
		if (!entry) throw new Error(`Unknown editor command: ${id}`);
		if (!this.isEnabled(id)) return false;
		await entry.run();
		return true;
	}

	dispose(): void {
		this.disposed = true;
		this.entries.clear();
	}
}
