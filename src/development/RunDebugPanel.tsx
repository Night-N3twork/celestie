import { Show } from "solid-js";
import RunIcon from "../icons/debug/run.svg";
import type { WorkbenchController } from "../workbench/createWorkbenchController";
import ToolSection from "../workbench/ToolSection";
import ToolWindowHeader from "../workbench/ToolWindowHeader";
import type { DevelopmentController } from "./createDevelopmentController";
import RunControls from "./RunControls";

export default function RunDebugPanel(props: {
	controller: WorkbenchController;
	development: DevelopmentController;
}) {
	const d = props.development;
	return (
		<aside
			class="file-explorer run-debug"
			aria-label="Run and Debug sidebar"
		>
			<ToolWindowHeader
				title="Run and Debug"
				onHide={() => props.controller.setSidebarOpen(false)}
			/>
			<Show
				when={d.root()}
				fallback={
					<div class="tool-empty">
						<p>Open a folder to run your project.</p>
						<button
							type="button"
							onClick={() =>
								void props.controller.run("folder.open")
							}
						>
							Open folder
						</button>
					</div>
				}
			>
				<div class="tool-window-toolbar">
					<RunControls development={d} />
				</div>
				<div class="tool-window-scroll">
					<ToolSection title="Sessions">
						<Show
							when={d.output() || d.running()}
							fallback={
								<p class="tool-empty">
									No active sessions. Choose a script and
									press Run.
								</p>
							}
						>
							<button
								type="button"
								class="run-session"
								onClick={() => d.setTab("output")}
							>
								<RunIcon size={18} nobox aria-hidden="true" />
								<span>
									{d.running() ? d.script() : "Last run"}
									<small>
										{d.running() ? "Running" : "Finished"} ·{" "}
										{d.root()?.name}
									</small>
								</span>
								<span
									classList={{
										"running-indicator": d.running(),
									}}
								/>
							</button>
							<button
								class="run-output-link"
								type="button"
								onClick={() => d.setTab("output")}
							>
								Show output
							</button>
						</Show>
					</ToolSection>
					<ToolSection title="Debugger" open={false}>
						<p class="tool-empty">
							Debugger integration is not available yet.
						</p>
					</ToolSection>
				</div>
			</Show>
		</aside>
	);
}
