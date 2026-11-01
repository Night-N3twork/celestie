import { For } from "solid-js";
import type { DevelopmentController } from "../development/createDevelopmentController";
import RunIcon from "../icons/debug/run.svg";
import ErrorIcon from "../icons/panels/error.svg";
import TerminalIcon from "../icons/panels/terminal.svg";

export default function ToolWindowBar(props: {
	development: DevelopmentController;
	problems: number;
}) {
	const d = props.development;
	const tools = [
		{ id: "terminal" as const, label: "Terminal", icon: TerminalIcon },
		{ id: "output" as const, label: "Output", icon: RunIcon },
		{ id: "problems" as const, label: "Problems", icon: ErrorIcon },
	];
	return (
		<nav class="tool-window-bar" aria-label="Development panels">
			<For each={tools}>
				{(tool) => (
					<button
						type="button"
						aria-pressed={d.tab() === tool.id}
						onClick={() => {
							if (d.tab() === tool.id) d.setTab(undefined);
							else if (tool.id === "terminal") d.showTerminal();
							else d.setTab(tool.id);
						}}
					>
						<tool.icon size={16} nobox aria-hidden="true" />
						{tool.label}
						<span class="tool-badge">
							{tool.id === "problems"
								? props.problems
								: tool.id === "output" && d.running()
									? "●"
									: undefined}
						</span>
					</button>
				)}
			</For>
		</nav>
	);
}
