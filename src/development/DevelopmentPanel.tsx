import { For, lazy, Show } from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import ActionButton from "../workbench/ActionButton";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import type { DevelopmentController } from "./createDevelopmentController";

const TerminalTabs = lazy(() => import("./TerminalTabs"));
export default function DevelopmentPanel(props: {
	controller: WorkbenchController;
	development: DevelopmentController;
}) {
	const c = props.controller,
		d = props.development;
	return (
		<section
			class="development"
			aria-label="Development tools"
			hidden={!d.tab()}
		>
			<nav class="development-actions" aria-label="Development panels">
				<button
					type="button"
					aria-pressed={d.tab() === "terminal"}
					onClick={d.showTerminal}
				>
					Terminal
				</button>
				<button
					type="button"
					aria-pressed={d.tab() === "output"}
					onClick={() => d.setTab("output")}
				>
					Output
				</button>
				<button
					type="button"
					aria-pressed={d.tab() === "problems"}
					onClick={() => d.setTab("problems")}
				>
					Problems ({c.language.problems().length})
				</button>
				<span class="development-folder">{d.root()?.name}</span>
				<ActionButton
					icon={CloseIcon}
					label="Close panel"
					compact
					onClick={() => d.setTab(undefined)}
				/>
			</nav>
			<Show when={d.error()}>
				<p role="alert">{d.error()}</p>
			</Show>
			<div class="development-content">
				<section aria-label="Problems" hidden={d.tab() !== "problems"}>
					<Show when={c.language.status()}>
						<p>{c.language.status()}</p>
					</Show>
					<For each={c.language.problems()}>
						{(problem) => (
							<button
								class="problem"
								type="button"
								onClick={() =>
									void c.perform(() =>
										c.navigateFile(problem.id, {
											anchor: problem.from,
											head: problem.to,
										}),
									)
								}
							>
								{problem.id.split("/").at(-1)}:{problem.line}:
								{problem.column} — {problem.severity} TS
								{problem.code}: {problem.message}
							</button>
						)}
					</For>
					<Show when={!c.language.problems().length}>
						<p>No reported problems.</p>
					</Show>
				</section>
				<pre
					class="task-output"
					aria-label="Task output"
					role="log"
					hidden={d.tab() !== "output"}
				>
					{d.output()}
				</pre>
				<div class="terminal-container" hidden={d.tab() !== "terminal"}>
					<Show
						when={d.root()}
						fallback={<p>Open a folder to use the terminal.</p>}
					>
						<Show when={d.terminalStarted()}>
							<Show
								when={c.platform.terminals}
								fallback={
									<Show
										when={d.runtimeRoot()}
										keyed
										fallback={
											<p>
												{d.error() ||
													"Preparing terminal…"}
											</p>
										}
									>
										{(root) => <TerminalTabs root={root} />}
									</Show>
								}
							>
								<TerminalTabs
									root={d.root()?.id ?? ""}
									host={c.platform.terminals}
								/>
							</Show>
						</Show>
					</Show>
				</div>
			</div>
		</section>
	);
}
