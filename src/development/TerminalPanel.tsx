import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { onCleanup, onMount } from "solid-js";
import "@xterm/xterm/css/xterm.css";
import type { TerminalHost, TerminalSession } from "../platform/services";

export default function TerminalPanel(props: {
	root: string;
	host: TerminalHost;
	active: boolean;
	onExit: (code: number) => void;
}) {
	let container!: HTMLElement;
	onMount(() => {
		const style = getComputedStyle(container);
		const terminal = new Terminal({
			fontFamily: '"JetBrains Mono Variable",monospace',
			fontSize: 12,
			theme: {
				background: style.getPropertyValue("--surface").trim(),
				foreground: style.getPropertyValue("--foreground").trim(),
			},
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		let disposed = false,
			session: TerminalSession | undefined,
			remove: (() => void) | undefined;
		const report = (error: unknown) => {
			if (!disposed) terminal.write(`\r\n${String(error)}\r\n`);
		};
		const observer = new ResizeObserver(() => {
			if (!container.clientWidth || !container.clientHeight) return;
			fit.fit();
			if (props.active) terminal.focus();
		});
		observer.observe(container);
		const input = terminal.onData((data) => {
			if (session) void session.write(data).catch(report);
		});
		const resize = terminal.onResize(({ cols, rows }) => {
			if (session) void session.resize(cols, rows).catch(report);
		});
		void (async () => {
			try {
				session = await props.host.open({
					cwd: props.root,
					cols: terminal.cols,
					rows: terminal.rows,
				});
				if (disposed) {
					await session.close();
					return;
				}
				remove = session.onData((text) => terminal.write(text));
				await session.resize(terminal.cols, terminal.rows);
				if (props.active) terminal.focus();
				const code = await session.exit;
				if (!disposed) {
					terminal.write(`\r\n[Shell exited ${code}]\r\n`);
					props.onExit(code);
				}
			} catch (error) {
				report(error);
				if (!disposed) props.onExit(1);
			}
		})();
		onCleanup(() => {
			disposed = true;
			observer.disconnect();
			input.dispose();
			resize.dispose();
			remove?.();
			void session?.close().catch(console.error);
			terminal.dispose();
		});
	});
	return (
		<section
			class="terminal-panel"
			ref={container}
			aria-label="Terminal screen"
		/>
	);
}
