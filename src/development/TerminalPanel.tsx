import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { onCleanup, onMount } from "solid-js";
import "@xterm/xterm/css/xterm.css";
import { duskEnvironment, duskPath } from "../platform/dusk/environment";
export default function TerminalPanel(props: { root: string }) {
	let container!: HTMLElement;
	onMount(() => {
		const terminal = new Terminal({
				fontFamily: '"JetBrains Mono Variable",monospace',
				fontSize: 12,
				convertEol: true,
				theme: {
					background: getComputedStyle(container)
						.getPropertyValue("--surface")
						.trim(),
					foreground: getComputedStyle(container)
						.getPropertyValue("--foreground")
						.trim(),
				},
			}),
			fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		let disposed = false,
			kill: (() => void) | undefined;
		const observer = new ResizeObserver(() => {
			try {
				fit.fit();
			} catch {}
		});
		observer.observe(container);
		const input = terminal.onData((data) => {
			if (send)
				void send(data).catch((error) =>
					terminal.write(`\r\n${String(error)}\r\n`),
				);
		});
		let send: ((data: string) => Promise<void>) | undefined;
		void (async () => {
			try {
				const env = await duskEnvironment();
				if (disposed) return;
				const process = await env.processes.spawn("/bin/dsh", [], {
					cwd: duskPath(props.root),
					env: {
						HOME: "/home/user",
						PATH: "/bin",
						TERM: "xterm-256color",
						USER: "user",
					},
					pty: { cols: terminal.cols, rows: terminal.rows },
				});
				kill = () => process.kill();
				if (disposed) {
					kill();
					return;
				}
				if (!process.master)
					throw new Error("Dusk did not attach a terminal.");
				process.master.onMasterData((bytes) => {
					if (!disposed) terminal.write(bytes);
				});
				send = async (data) => {
					await process.stdin.write(new TextEncoder().encode(data));
				};
				terminal.onResize((size) =>
					env.processes.resizePty(process.pid, size.cols, size.rows),
				);
				await process.exit;
				if (!disposed)
					terminal.write(
						"\r\n[Shell exited. Close and reopen Terminal to restart.]\r\n",
					);
			} catch (error) {
				if (!disposed) terminal.write(`\r\n${String(error)}\r\n`);
			}
		})();
		onCleanup(() => {
			disposed = true;
			observer.disconnect();
			input.dispose();
			kill?.();
			terminal.dispose();
		});
	});
	return (
		<section
			class="terminal-panel"
			ref={container}
			aria-label="Dusk terminal"
		/>
	);
}
