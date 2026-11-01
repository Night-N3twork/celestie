import type { Accessor, Setter } from "solid-js";
import { For } from "solid-js";
import MoreIcon from "../icons/actions/more.svg";
import type { EditorSettings } from "../settings/editorSettings";
import type { EditorGroup, WorkspaceLayout } from "../workspace/layout";
import type { Workspace } from "../workspace/workspace";

interface Props {
	run: (id: string) => Promise<unknown>;
	activeGroup: Accessor<string>;
	workspace: Accessor<Workspace>;
	layout: Accessor<WorkspaceLayout>;
	changed: () => void;
	groups: Accessor<EditorGroup[]>;
	settings: Accessor<EditorSettings>;
	setSettings: Setter<EditorSettings>;
	busy: Accessor<boolean>;
}

export default function ViewMenu(props: Props) {
	const {
		run,
		activeGroup,
		workspace,
		layout,
		changed,
		groups,
		settings,
		setSettings,
		busy,
	} = props;
	return (
		<details
			class="view-menu"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.open = false;
					event.currentTarget.querySelector("summary")?.focus();
				}
			}}
			onClick={(event) => {
				if ((event.target as Element).closest("button"))
					event.currentTarget.open = false;
			}}
		>
			<summary title="View and editor settings">
				<MoreIcon size={24} nobox aria-hidden="true" />
				<span>View</span>
			</summary>
			<div class="view-menu-content">
				<div class="menu-heading">Panels</div>
				<button
					type="button"
					onClick={() => void run("terminal.toggle")}
				>
					Terminal <kbd>Ctrl `</kbd>
				</button>
				<button type="button" onClick={() => void run("problems.show")}>
					Problems
				</button>
				<button type="button" onClick={() => void run("git.show")}>
					Source control
				</button>
				<div class="menu-heading">Navigation</div>
				<button
					type="button"
					onClick={() => void run("navigation.line")}
				>
					Go to line <kbd>Ctrl G</kbd>
				</button>
				<button
					type="button"
					onClick={() => void run("navigation.symbols")}
				>
					Symbols
				</button>
				<button
					type="button"
					onClick={() => void run("navigation.back")}
				>
					Back
				</button>
				<button
					type="button"
					onClick={() => void run("navigation.forward")}
				>
					Forward
				</button>
				<div class="menu-heading">Layout</div>
				<button
					type="button"
					onClick={() => void run("layout.orientation")}
				>
					Split orientation
				</button>
				<button
					type="button"
					onClick={() => void run("layout.tabLeft")}
				>
					Move tab left
				</button>
				<button
					type="button"
					onClick={() => void run("layout.tabRight")}
				>
					Move tab right
				</button>
				<label>
					Move tab to group{" "}
					<select
						aria-label="Move tab to group"
						value={activeGroup()}
						onChange={(event) => {
							const document = workspace().active;
							if (document)
								layout().move(
									document.id,
									event.currentTarget.value,
								);
							changed();
						}}
					>
						<For each={groups()}>
							{(group, index) => (
								<option value={group.id}>{index() + 1}</option>
							)}
						</For>
					</select>
				</label>
				<div class="menu-heading">Editor</div>
				<label>
					Font{" "}
					<input
						type="number"
						min="10"
						max="32"
						value={settings().fontSize}
						onInput={(event) => {
							const size = event.currentTarget.valueAsNumber;
							if (
								Number.isInteger(size) &&
								size >= 10 &&
								size <= 32
							)
								setSettings({
									...settings(),
									fontSize: size,
								});
						}}
					/>
				</label>
				<label>
					Tab size{" "}
					<select
						value={settings().tabSize}
						onChange={(event) =>
							setSettings({
								...settings(),
								tabSize: Number(event.currentTarget.value),
							})
						}
					>
						<option value="2">2</option>
						<option value="4">4</option>
						<option value="8">8</option>
					</select>
				</label>
				<label>
					<input
						type="checkbox"
						checked={settings().insertSpaces}
						onChange={(event) =>
							setSettings({
								...settings(),
								insertSpaces: event.currentTarget.checked,
							})
						}
					/>{" "}
					Spaces
				</label>
				<label>
					<input
						type="checkbox"
						checked={settings().lineNumbers}
						onChange={(event) =>
							setSettings({
								...settings(),
								lineNumbers: event.currentTarget.checked,
							})
						}
					/>{" "}
					Line numbers
				</label>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("file.download")}
				>
					Download copy
				</button>
			</div>
		</details>
	);
}
