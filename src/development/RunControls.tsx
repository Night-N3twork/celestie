import { For, Show } from "solid-js";
import RunIcon from "../icons/debug/run.svg";
import StopIcon from "../icons/debug/stop.svg";
import ActionButton from "../workbench/ActionButton";
import type { DevelopmentController } from "./createDevelopmentController";

export default function RunControls(props: {
	development: DevelopmentController;
}) {
	const d = props.development;
	return (
		<div class="run-controls">
			<label class="run-selector">
				<select
					aria-label="Run script"
					value={d.script()}
					disabled={d.running()}
					onChange={(event) => d.setScript(event.currentTarget.value)}
				>
					<For each={d.scripts()}>
						{(name) => <option>{name}</option>}
					</For>
				</select>
			</label>
			<div class="run-actions">
				<ActionButton
					icon={RunIcon}
					label="Run project"
					compact
					disabled={d.running() || !d.script()}
					onClick={() => void d.run()}
				/>
				<Show when={d.running()}>
					<ActionButton
						icon={StopIcon}
						label="Stop task"
						compact
						onClick={d.stopTask}
					/>
				</Show>
			</div>
		</div>
	);
}
