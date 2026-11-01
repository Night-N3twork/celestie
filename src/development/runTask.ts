import { parse } from "shell-quote";
import { duskEnvironment, duskPath } from "../platform/dusk/environment";
export async function runPackageScript(
	root: string,
	name: string,
	write: (text: string) => void,
	signal: AbortSignal,
): Promise<number> {
	const { fs, processes } = await duskEnvironment(),
		cwd = duskPath(root);
	signal.throwIfAborted();
	const manifest = JSON.parse(await fs.readFile(`${cwd}/package.json`));
	if (typeof manifest.scripts?.[name] !== "string")
		throw new Error("The selected script no longer exists.");
	const drain = async (stream: ReadableStream<Uint8Array>) => {
		const reader = stream.getReader(),
			decoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				write(decoder.decode(value, { stream: true }));
			}
			write(decoder.decode());
		} finally {
			reader.releaseLock();
		}
	};
	for (const step of [`pre${name}`, name, `post${name}`]) {
		const command = manifest.scripts[step];
		if (typeof command !== "string") continue;
		signal.throwIfAborted();
		write(`> ${step}\n`);
		const words = /[$`~*?]/.test(command) ? undefined : parse(command);
		const direct =
			words?.every((word) => typeof word === "string") &&
			["node", "/bin/node"].includes(String(words[0]));
		const process = await processes.spawn(
			direct ? "/bin/celestie-task-node" : "/bin/dsh",
			direct ? (words as string[]).slice(1) : ["-c", command],
			{
				cwd,
				env: {
					HOME: "/home/user",
					PATH: `${cwd}/node_modules/.bin:/bin`,
					USER: "user",
					INIT_CWD: cwd,
					npm_lifecycle_event: step,
					npm_lifecycle_script: command,
					npm_package_json: `${cwd}/package.json`,
					npm_package_name: String(manifest.name ?? ""),
					npm_package_version: String(manifest.version ?? ""),
				},
			},
		);
		const stop = () => {
			const visited = new Set<number>();
			const kill = (pid: number) => {
				if (visited.has(pid)) return;
				visited.add(pid);
				for (const child of processes.activePids())
					if (processes.getProcessRecord(child)?.ppid === pid)
						kill(child);
				processes.getProcess(pid)?.kill();
			};
			kill(process.pid);
		};
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) stop();
		try {
			const [exit] = await Promise.all([
				process.exit,
				drain(process.stdout),
				drain(process.stderr),
			]);
			signal.throwIfAborted();
			if (exit !== 0) return exit;
		} finally {
			signal.removeEventListener("abort", stop);
		}
	}
	return 0;
}
