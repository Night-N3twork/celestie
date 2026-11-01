import type { TerminalHost } from "../services";
import { duskEnvironment, duskPath } from "./environment";

export const duskTerminals: TerminalHost = {
	async open({ cwd, cols, rows }) {
		const env = await duskEnvironment();
		const process = await env.processes.spawn("/bin/dsh", [], {
			cwd: duskPath(cwd),
			env: {
				HOME: "/home/user",
				PATH: "/bin",
				TERM: "xterm-256color",
				USER: "user",
			},
			pty: { cols, rows },
		});
		if (!process.master) {
			process.kill();
			throw new Error("Dusk did not attach a terminal.");
		}
		return {
			id: String(process.pid),
			exit: process.exit,
			write: async (data) => {
				await process.stdin.write(new TextEncoder().encode(data));
			},
			resize: async (cols, rows) => {
				env.processes.resizePty(process.pid, cols, rows);
			},
			onData: (listener) => {
				let active = true;
				const decoder = new TextDecoder();
				process.master?.onMasterData((bytes) => {
					if (active)
						listener(decoder.decode(bytes, { stream: true }));
				});
				return () => {
					active = false;
				};
			},
			close: async () => {
				process.kill();
			},
		};
	},
};
