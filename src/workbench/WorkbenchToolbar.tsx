import type { Accessor, JSX, Setter } from "solid-js";
import FileIcon from "../icons/files/file.svg";
import NewFileIcon from "../icons/files/new-file.svg";
import SplitIcon from "../icons/navigation/expand-all.svg";
import ExplorerIcon from "../icons/panels/explorer.svg";
import SearchIcon from "../icons/panels/search.svg";
import type { EditorSettings } from "../settings/editorSettings";
import type { EditorGroup, WorkspaceLayout } from "../workspace/layout";
import type { Workspace } from "../workspace/workspace";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";
import ActionButton from "./ActionButton";
import ViewMenu from "./ViewMenu";

interface Props {
	children?: JSX.Element;
	busy: Accessor<boolean>;
	file: Accessor<WorkspaceDocument | undefined>;
	run: (id: string) => Promise<unknown>;
	activeGroup: Accessor<string>;
	workspace: Accessor<Workspace>;
	layout: Accessor<WorkspaceLayout>;
	changed: () => void;
	groups: Accessor<EditorGroup[]>;
	settings: Accessor<EditorSettings>;
	setSettings: Setter<EditorSettings>;
}

export default function WorkbenchToolbar(props: Props) {
	const {
		busy,
		file,
		run,
		activeGroup,
		workspace,
		layout,
		changed,
		groups,
		settings,
		setSettings,
	} = props;
	return (
		<nav class="editor-toolbar" aria-label="File and edit commands">
			<div class="toolbar-group">
				<ActionButton
					label="New"
					icon={NewFileIcon}
					disabled={busy()}
					onClick={() => void run("file.new")}
				/>
				<ActionButton
					label="Open"
					icon={FileIcon}
					disabled={busy()}
					onClick={() => void run("file.open")}
				/>
				<ActionButton
					label="Open folder"
					icon={ExplorerIcon}
					disabled={busy()}
					onClick={() => void run("folder.open")}
				/>
				<ActionButton
					label="Save"
					primary
					disabled={busy() || !file()}
					onClick={() => void run("file.save")}
				/>
			</div>
			<div class="toolbar-group">
				<ActionButton
					label="Undo"
					disabled={busy()}
					onClick={() => void run("edit.undo")}
				/>
				<ActionButton
					label="Redo"
					disabled={busy()}
					onClick={() => void run("edit.redo")}
				/>
			</div>
			<div class="toolbar-group">
				<ActionButton
					label="Find"
					icon={SearchIcon}
					disabled={busy() || !file()}
					onClick={() => void run("search.find")}
				/>
				<ActionButton
					label="Find and replace"
					disabled={busy() || !file()}
					onClick={() => void run("search.replace")}
				/>
			</div>
			{props.children}
			<div class="toolbar-spacer" />
			<ActionButton
				label="Split editor"
				icon={SplitIcon}
				compact
				disabled={busy()}
				onClick={() => void run("layout.split")}
			/>
			<ViewMenu
				run={run}
				activeGroup={activeGroup}
				workspace={workspace}
				layout={layout}
				changed={changed}
				groups={groups}
				settings={settings}
				setSettings={setSettings}
				busy={busy}
			/>
		</nav>
	);
}
