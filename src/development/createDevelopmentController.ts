import { createEffect, createSignal, onCleanup } from "solid-js";
import stripAnsi from "strip-ansi";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import { runPackageScript } from "./runTask";
export function createDevelopmentController(c: WorkbenchController) {
	const [tab, setTab] = createSignal<"terminal" | "output" | "problems">();
	const [sidebarView, setSidebarView] = createSignal<
		"explorer" | "git" | "run"
	>("explorer");
	const [terminalStarted, setTerminalStarted] = createSignal(false);
	const [scripts, setScripts] = createSignal<string[]>([]);
	const [script, setScript] = createSignal("");
	const [running, setRunning] = createSignal(false);
	const [output, setOutput] = createSignal("");
	const [error, setError] = createSignal("");
	const [mount, setMount] = createSignal<{
		logical: string;
		runtime: string;
	}>();
	const roots = () =>
		c
			.folders()
			.filter((root) => root.accessible)
			.map((root) => root.entry);
	const root = () => {
		const entries = roots(),
			active = c.file()?.id,
			selected = c.selectedEntry()?.id;
		return (
			entries.find(
				(root) =>
					active === root.id || active?.startsWith(`${root.id}/`),
			) ??
			entries.find(
				(root) =>
					selected === root.id || selected?.startsWith(`${root.id}/`),
			) ??
			entries.at(-1)
		);
	};
	const runtimeRoot = () =>
		mount()?.logical === root()?.id ? mount()?.runtime : undefined;
	let disposed = false,
		loadVersion = 0,
		mountVersion = 0,
		stopTask: (() => void) | undefined;
	const write = (text: string) => {
		if (!disposed) setOutput((value) => (value + text).slice(-200000));
	};
	const prepare = async () => {
		const entry = root();
		if (!entry) throw new Error("Open a folder to use workspace tools.");
		const version = ++mountVersion;
		const runtime = await c.host.runtimeRoot(entry);
		if (!disposed && version === mountVersion && root()?.id === entry.id)
			setMount({ logical: entry.id, runtime });
		return runtime;
	};
	const showTerminal = () => {
		setTerminalStarted(true);
		setTab("terminal");
	};
	const showSourceControl = () => {
		c.setWorkspaceSearchOpen(false);
		setSidebarView("git");
		c.setSidebarOpen(true);
	};
	const showRunAndDebug = () => {
		c.setWorkspaceSearchOpen(false);
		setSidebarView("run");
		c.setSidebarOpen(true);
	};
	const showExplorer = () => {
		if (c.workspaceSearchOpen()) {
			c.setWorkspaceSearchOpen(false);
			setSidebarView("explorer");
			c.setSidebarOpen(true);
		} else if (sidebarView() === "explorer")
			c.setSidebarOpen((value) => !value);
		else {
			setSidebarView("explorer");
			c.setSidebarOpen(true);
		}
	};
	createEffect(() => {
		if (!root()) {
			setMount(undefined);
			setError("");
			return;
		}
		if (
			(!c.platform.terminals && terminalStarted()) ||
			sidebarView() === "git"
		) {
			setError("");
			void prepare().catch((error) => {
				if (!disposed) setError(String(error));
			});
		}
	});
	createEffect(() => {
		c.revision();
		const id = root()?.id,
			current = ++loadVersion;
		if (!id) {
			setScripts([]);
			setScript("");
			return;
		}
		const buffer = c
			.documents()
			.find((document) => document.id === `${id}/package.json`);
		const read = buffer
			? Promise.resolve(buffer.editor.snapshot.text)
			: c.host
					.readTextFile(`${id}/package.json`)
					.then((file) => file.text);
		void read
			.then((text) => {
				if (current !== loadVersion) return;
				const data = JSON.parse(text),
					names = Object.keys(data.scripts ?? {}).filter(
						(name) => typeof data.scripts[name] === "string",
					);
				setScripts(names);
				setScript((current) =>
					names.includes(current)
						? current
						: names.includes("start")
							? "start"
							: (names[0] ?? ""),
				);
			})
			.catch(() => {
				if (current === loadVersion) {
					setScripts([]);
					setScript("");
				}
			});
	});
	const run = async () => {
		const entry = root(),
			selected = script();
		if (!entry || !selected || running()) return;
		const abort = new AbortController();
		stopTask = () => abort.abort();
		setRunning(true);
		setTab("output");
		setOutput("");
		setError("");
		try {
			for (const document of c.documents())
				if (document.id.startsWith(`${entry.id}/`) && document.dirty)
					await document.save(c.host);
			c.changed();
			const native = c.platform.processes;
			let exit: number;
			if (native) {
				abort.signal.throwIfAborted();
				const process = await native.runScript(entry.id, selected);
				const remove = process.onOutput(({ text }) => write(text));
				const stop = () => {
					void process
						.stop()
						.catch((error) => setError(String(error)));
				};
				abort.signal.addEventListener("abort", stop, { once: true });
				if (abort.signal.aborted) stop();
				try {
					exit = await process.exit;
					abort.signal.throwIfAborted();
				} finally {
					remove();
					abort.signal.removeEventListener("abort", stop);
				}
			} else {
				const runtime = await c.host.runtimeRoot(entry);
				exit = await runPackageScript(
					runtime,
					selected,
					write,
					abort.signal,
				);
			}
			write(`\n[Exited ${exit}]\n`);
			c.refreshExplorer();
			await c.language.refresh();
		} catch (error) {
			if (!disposed) {
				if (abort.signal.aborted) write("\n[Stopped]\n");
				else setError(String(error));
			}
		} finally {
			stopTask = undefined;
			if (!disposed) setRunning(false);
		}
	};
	const unregister = [
		c.commands.register({
			id: "language.refresh",
			title: "Refresh project analysis",
			execute: async () => {
				await c.language.refresh();
			},
		}),
		c.commands.register({
			id: "terminal.toggle",
			title: "Toggle Terminal",
			execute: () => {
				if (tab() === "terminal") setTab(undefined);
				else showTerminal();
			},
		}),
		c.commands.register({
			id: "task.run",
			title: "Run project script",
			execute: run,
		}),
		c.commands.register({
			id: "problems.show",
			title: "Show Problems",
			execute: () => {
				setTab("problems");
			},
		}),
		c.commands.register({
			id: "git.show",
			title: "Show Source Control",
			execute: showSourceControl,
		}),
		c.commands.register({
			id: "debug.show",
			title: "Show Run and Debug",
			execute: showRunAndDebug,
		}),
	];
	const keydown = (event: KeyboardEvent) => {
		if (
			(event.ctrlKey || event.metaKey) &&
			event.shiftKey &&
			event.code === "KeyD" &&
			!event.altKey &&
			!event.isComposing
		) {
			event.preventDefault();
			showRunAndDebug();
		}
		if (
			(event.ctrlKey || event.metaKey) &&
			event.code === "Backquote" &&
			!event.altKey &&
			!event.isComposing
		) {
			event.preventDefault();
			if (tab() === "terminal") setTab(undefined);
			else showTerminal();
		}
	};
	window.addEventListener("keydown", keydown);
	onCleanup(() => {
		disposed = true;
		loadVersion++;
		mountVersion++;
		stopTask?.();
		window.removeEventListener("keydown", keydown);
		for (const remove of unregister) remove();
	});
	return {
		tab,
		setTab,
		sidebarView,
		terminalStarted,
		root,
		runtimeRoot,
		scripts,
		script,
		setScript,
		running,
		output: () => stripAnsi(output()),
		rawOutput: output,
		error,
		run,
		showTerminal,
		showSourceControl,
		showRunAndDebug,
		showExplorer,
		stopTask: () => stopTask?.(),
		workspaceFile: (runtimeId: string) => {
			const mountValue = mount();
			return mountValue && runtimeId.startsWith(`${mountValue.runtime}/`)
				? mountValue.logical +
						runtimeId.slice(mountValue.runtime.length)
				: runtimeId;
		},
	};
}
export type DevelopmentController = ReturnType<
	typeof createDevelopmentController
>;
