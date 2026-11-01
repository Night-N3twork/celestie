export interface Command {
	readonly id: string;
	readonly title: string;
	readonly execute: () => void | Promise<void>;
}

export class CommandRegistry {
	private readonly commands = new Map<string, Command>();

	list(): readonly Command[] {
		return [...this.commands.values()];
	}

	register(command: Command): () => void {
		if (this.commands.has(command.id)) {
			throw new Error(`Command already registered: ${command.id}`);
		}
		this.commands.set(command.id, { ...command });
		const registered = this.commands.get(command.id);
		return () => {
			if (this.commands.get(command.id) === registered) {
				this.commands.delete(command.id);
			}
		};
	}

	async execute(id: string): Promise<void> {
		const command = this.commands.get(id);
		if (!command) throw new Error(`Unknown command: ${id}`);
		await command.execute();
	}
}
