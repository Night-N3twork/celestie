export interface AtomicMutation {
	begin(): void;
	apply(): void;
	notify(): void;
	end(): void;
}

export function commitAtomic(mutations: readonly AtomicMutation[]): void {
	const locked: AtomicMutation[] = [];
	try {
		for (const mutation of mutations) {
			mutation.begin();
			locked.push(mutation);
		}
		for (const mutation of mutations) mutation.apply();
		for (const mutation of mutations) mutation.notify();
	} finally {
		for (const mutation of locked) mutation.end();
	}
}

export class WorkspaceHistory {
	constructor(
		private readonly participants: readonly {
			available(redo: boolean): boolean;
			prepare(redo: boolean): AtomicMutation;
		}[],
	) {}
	available(redo: boolean): boolean {
		return this.participants.every((participant) =>
			participant.available(redo),
		);
	}
	replay(redo: boolean): void {
		if (!this.available(redo))
			throw new Error(
				"Workspace history is unavailable. Undo later edits in every document first; closed, cleared or branched histories cannot be replayed together.",
			);
		commitAtomic(
			this.participants.map((participant) => participant.prepare(redo)),
		);
	}
}
