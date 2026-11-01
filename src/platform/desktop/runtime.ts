import type { ProcessHost, RunningProcess, TerminalHost } from "../services";
import {
	type DesktopBridge,
	type Result,
	type RuntimeEvent,
	unwrap,
} from "./bridge";

export function createDesktopRuntime(bridge: DesktopBridge) {
	async function connect(id: string) {
		const listeners = new Set<(event: RuntimeEvent) => void>();
		const pending: RuntimeEvent[] = [];
		let resolve!: (code: number) => void;
		const exit = new Promise<number>((done) => {
			resolve = done;
		});
		const remove = bridge.onRuntimeEvent((event) => {
			if (event.id !== id) return;
			if (event.type === "exit") {
				resolve(event.code);
				remove();
			} else if (!listeners.size) pending.push(event);
			for (const listener of listeners) listener(event);
		});
		try {
			await unwrap(bridge.runtime.listen(id));
		} catch (error) {
			remove();
			await unwrap(bridge.runtime.stop(id));
			throw error;
		}
		return {
			id,
			exit,
			onOutput(listener: (event: RuntimeEvent) => void) {
				listeners.add(listener);
				for (const event of pending.splice(0)) listener(event);
				return () => {
					listeners.delete(listener);
				};
			},
			stop: () => unwrap(bridge.runtime.stop(id)),
		};
	}
	async function process(
		request: Promise<Result<string>>,
	): Promise<RunningProcess> {
		const session = await connect(await unwrap(request));
		return {
			...session,
			onOutput: (listener) =>
				session.onOutput((event) => {
					if (event.type === "output") listener(event);
				}),
		};
	}
	const processes: ProcessHost = {
		spawn: (options) => process(bridge.runtime.spawn(options)),
		runScript: (cwd, name) => process(bridge.runtime.runScript(cwd, name)),
	};
	const terminals: TerminalHost = {
		async open(options) {
			const session = await connect(
				await unwrap(bridge.runtime.open(options)),
			);
			return {
				id: session.id,
				exit: session.exit,
				write: (data) => unwrap(bridge.runtime.write(session.id, data)),
				resize: (cols, rows) =>
					unwrap(bridge.runtime.resize(session.id, cols, rows)),
				onData: (listener) =>
					session.onOutput((event) => {
						if (event.type === "output") listener(event.text);
					}),
				close: session.stop,
			};
		},
	};
	return { processes, terminals };
}
