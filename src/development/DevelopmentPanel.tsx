import { createSignal, lazy, Show } from "solid-js";
import StopIcon from "../icons/debug/stop.svg";
import ActionButton from "../workbench/ActionButton";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import DockResizeHandle from "../workbench/DockResizeHandle";
import ToolWindowHeader from "../workbench/ToolWindowHeader";
import type { DevelopmentController } from "./createDevelopmentController";
import ProblemsPanel from "./ProblemsPanel";
import TaskOutput from "./TaskOutput";

const TerminalTabs = lazy(() => import("./TerminalTabs"));
export default function DevelopmentPanel(props: {
	controller: WorkbenchController;
	development: DevelopmentController;
}) {
	const [height, setHeight] = createSignal(260);
	const c = props.controller,
		d = props.development;
	return (
		<section
			class="development"
			aria-label="Development tools"
			hidden={!d.tab()}
		>
			<DockResizeHandle
				axis="vertical"
				label="Resize bottom panel"
				value={height()}
				min={100}
				max={() => window.innerHeight * 0.65}
				onResize={setHeight}
				reverse
			/>
			<ToolWindowHeader
				title={
					d.tab() === "terminal"
						? "Terminal"
						: d.tab() === "output"
							? "Output"
							: "Problems"
				}
				onHide={() => d.setTab(undefined)}
			>
				<span class="development-folder">{d.root()?.name}</span>
				<Show when={d.tab() === "output" && d.running()}>
					<ActionButton
						icon={StopIcon}
						label="Stop task"
						compact
						onClick={d.stopTask}
					/>
				</Show>
			</ToolWindowHeader>
			<Show when={d.error()}>
				<p role="alert">{d.error()}</p>
			</Show>
			<div
				class="development-content"
				style={{ height: `${height()}px` }}
			>
				<ProblemsPanel
					controller={c}
					visible={d.tab() === "problems"}
				/>
				<TaskOutput
					text={d.rawOutput()}
					visible={d.tab() === "output" && !!d.rawOutput()}
				/>
				<Show when={d.tab() === "output" && !d.rawOutput()}>
					<p class="tool-empty">
						No task output yet. Run a task from Run and Debug to see
						its output here.
					</p>
				</Show>
				<div class="terminal-container" hidden={d.tab() !== "terminal"}>
					<Show
						when={d.root()}
						fallback={
							<div class="tool-empty">
								<p>Open a folder to use the terminal.</p>
								<button
									type="button"
									onClick={() => void c.run("folder.open")}
								>
									Open folder
								</button>
							</div>
						}
					>
						<Show when={d.terminalStarted()}>
							<Show
								when={c.platform.terminals}
								fallback={
									<Show
										when={d.runtimeRoot()}
										keyed
										fallback={
											<p class="tool-empty">
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
