import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";
import { type IPty, spawn as spawnPty } from "node-pty";
import type { RuntimeEvent } from "../src/platform/desktop/bridge";
import type { NativeWorkspace } from "./files";
import { registerMethods } from "./ipc";

interface Session {
	id: string;
	pty?: IPty;
	pid: number;
	listening: boolean;
	ended: boolean;
	pending: RuntimeEvent[];
	buffered: number;
	stopping?: Promise<void>;
}
function text(value: unknown): string {
	if (typeof value !== "string" || value.includes("\0"))
		throw new Error("Invalid text.");
	return value;
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid options.");
	return value as Record<string, unknown>;
}
function dimension(value: unknown) {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1000)
		throw new Error("Invalid terminal size.");
	return Number(value);
}
function environment(overrides?: unknown): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of Object.keys(env))
		if (/^(ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(key))
			delete env[key];
	if (overrides !== undefined)
		for (const [key, value] of Object.entries(object(overrides))) {
			if (!key || /[=\0]/.test(key))
				throw new Error("Invalid environment variable.");
			env[key] = text(value);
		}
	return env;
}
export class NativeRuntime {
	private sessions = new Map<string, Session>();
	private closing = false;
	constructor(
		private files: NativeWorkspace,
		private getWindow: () => BrowserWindow | undefined,
		origin: string,
	) {
		registerMethods(
			"runtime",
			{
				spawn: (options) => this.spawn(object(options)),
				runScript: (cwd, name) => this.runScript(text(cwd), text(name)),
				open: (options) => this.open(object(options)),
				listen: (id) => {
					const session = this.session(id);
					session.listening = true;
					for (const event of session.pending.splice(0))
						this.send(session, event);
					session.buffered = 0;
					if (session.ended) this.sessions.delete(session.id);
				},
				write: (id, data) => {
					const session = this.session(id);
					if (!session.pty || session.ended)
						throw new Error("Terminal has exited.");
					if (typeof data !== "string")
						throw new Error("Invalid terminal input.");
					const value = data;
					if (value.length > 1024 * 1024)
						throw new Error("Terminal input is too large.");
					session.pty.write(value);
				},
				resize: (id, cols, rows) => {
					const session = this.session(id);
					if (!session.pty || session.ended)
						throw new Error("Terminal has exited.");
					session.pty.resize(dimension(cols), dimension(rows));
				},
				stop: (id) => this.stop(text(id)),
			},
			getWindow,
			origin,
		);
	}
	private session(id: unknown) {
		const session = this.sessions.get(text(id));
		if (!session) throw new Error("Process no longer exists.");
		return session;
	}
	private create(): Session {
		if (this.closing) throw new Error("Application is closing.");
		if (this.sessions.size >= 64)
			throw new Error("Close an existing terminal or task first.");
		const session: Session = {
			id: randomUUID(),
			pid: 0,
			listening: false,
			ended: false,
			pending: [],
			buffered: 0,
		};
		this.sessions.set(session.id, session);
		return session;
	}
	private send(session: Session, event: RuntimeEvent) {
		if (!session.listening) {
			session.pending.push(event);
			if (event.type === "output") session.buffered += event.text.length;
			while (session.buffered > 200000 && session.pending.length > 1) {
				const removed = session.pending.shift();
				if (removed?.type === "output")
					session.buffered -= removed.text.length;
			}
			return;
		}
		const window = this.getWindow();
		if (window && !window.isDestroyed())
			window.webContents.send("runtime.event", event);
	}
	private end(session: Session, code: number) {
		if (session.ended) return;
		session.ended = true;
		this.send(session, { id: session.id, type: "exit", code });
		if (session.listening) this.sessions.delete(session.id);
	}
	private async spawn(options: Record<string, unknown>) {
		const cwd = await this.files.workingDirectory(text(options.cwd));
		const command = text(options.command);
		if (!command) throw new Error("Command is empty.");
		if (!Array.isArray(options.args) || options.args.length > 1024)
			throw new Error("Invalid arguments.");
		const args = options.args.map(text),
			env = environment(options.env);
		return this.launch(command, args, cwd, env);
	}
	private launch(
		command: string,
		args: string[],
		cwd: string,
		env: NodeJS.ProcessEnv,
	) {
		const session = this.create();
		try {
			const child = spawn(command, args, {
				cwd,
				env,
				detached: process.platform !== "win32",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			session.pid = child.pid ?? 0;
			for (const stream of ["stdout", "stderr"] as const) {
				child[stream]?.setEncoding("utf8");
				child[stream]?.on("data", (text: string) =>
					this.send(session, {
						id: session.id,
						type: "output",
						stream,
						text,
					}),
				);
			}
			child.on("error", (error) => {
				this.send(session, {
					id: session.id,
					type: "output",
					stream: "stderr",
					text: `${error.message}\n`,
				});
			});
			child.on("close", (code) => this.end(session, code ?? 1));
			return session.id;
		} catch (error) {
			this.sessions.delete(session.id);
			throw error;
		}
	}
	private async runScript(id: string, name: string) {
		const cwd = await this.files.workingDirectory(id);
		const manifest = JSON.parse(
			await readFile(path.join(cwd, "package.json"), "utf8"),
		);
		if (
			!Object.hasOwn(manifest.scripts ?? {}, name) ||
			typeof manifest.scripts[name] !== "string"
		)
			throw new Error("The selected script no longer exists.");
		if (!/^[\w:@./-]+$/.test(name))
			throw new Error(
				"Unsupported script name. Run it from the terminal.",
			);
		let manager = String(manifest.packageManager ?? "").split("@")[0];
		if (!["bun", "npm", "pnpm", "yarn"].includes(manager)) {
			manager = "npm";
			for (const [file, candidate] of [
				["bun.lock", "bun"],
				["bun.lockb", "bun"],
				["pnpm-lock.yaml", "pnpm"],
				["yarn.lock", "yarn"],
			]) {
				if (
					await stat(path.join(cwd, file)).then(
						() => true,
						() => false,
					)
				) {
					manager = candidate;
					break;
				}
			}
		}
		const env = environment();
		if (process.platform === "win32" && manager !== "bun")
			return this.launch(
				process.env.ComSpec || "cmd.exe",
				["/d", "/s", "/c", `${manager}.cmd run ${name}`],
				cwd,
				env,
			);
		return this.launch(manager, ["run", name], cwd, env);
	}
	private async open(options: Record<string, unknown>) {
		const cwd = await this.files.workingDirectory(text(options.cwd));
		const cols = dimension(options.cols),
			rows = dimension(options.rows);
		const session = this.create();
		try {
			const shell =
				process.platform === "win32"
					? "powershell.exe"
					: process.env.SHELL || "/bin/sh";
			const pty = spawnPty(
				shell,
				process.platform === "win32" ? ["-NoLogo"] : ["-l"],
				{
					cwd,
					cols,
					rows,
					name: "xterm-256color",
					env: {
						...environment(),
						TERM: "xterm-256color",
						COLORTERM: "truecolor",
					},
				},
			);
			session.pty = pty;
			session.pid = pty.pid;
			pty.onData((text) =>
				this.send(session, {
					id: session.id,
					type: "output",
					stream: "stdout",
					text,
				}),
			);
			pty.onExit(({ exitCode }) => this.end(session, exitCode));
			return session.id;
		} catch (error) {
			this.sessions.delete(session.id);
			throw error;
		}
	}
	async stop(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) return;
		if (session.stopping) return session.stopping;
		session.stopping = (async () => {
			if (!session.ended && session.pid) {
				if (process.platform === "win32") {
					try {
						await promisify(execFile)(
							path.join(
								process.env.SystemRoot || "C:\\Windows",
								"System32/taskkill.exe",
							),
							["/pid", String(session.pid), "/t", "/f"],
							{ windowsHide: true },
						);
					} catch (error) {
						if (!session.ended) throw error;
					}
				} else {
					try {
						process.kill(-session.pid, "SIGKILL");
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ESRCH")
							throw error;
					}
				}
			}
			if (session.pty && !session.ended) {
				try {
					session.pty.kill();
				} catch {}
			}
			this.end(session, 1);
			this.sessions.delete(id);
		})();
		return session.stopping;
	}
	async close() {
		this.closing = true;
		const results = await Promise.allSettled(
			[...this.sessions.keys()].map((id) => this.stop(id)),
		);
		for (const result of results)
			if (result.status === "rejected")
				console.error("Could not stop process:", result.reason);
		this.closing = false;
	}
}
