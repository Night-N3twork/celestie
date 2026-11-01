import type { Accessor, Setter } from "solid-js";
import DebugIcon from "../icons/panels/debug.svg";
import ExplorerIcon from "../icons/panels/explorer.svg";
import GitIcon from "../icons/panels/git.svg";
import SearchIcon from "../icons/panels/search.svg";

interface Props {
	runAndDebugOpen: Accessor<boolean>;
	onRunAndDebug: () => void;
	sourceControlOpen: Accessor<boolean>;
	onSourceControl: () => void;
	onExplorer: () => void;
	sidebarOpen: Accessor<boolean>;
	setSidebarOpen: Setter<boolean>;
	workspaceSearchOpen: Accessor<boolean>;
	setWorkspaceSearchOpen: Setter<boolean>;
	openWorkspaceSearch: (replace?: boolean) => void;
}

export default function ActivityRail(props: Props) {
	const { sidebarOpen, workspaceSearchOpen, setWorkspaceSearchOpen } = props;
	return (
		<nav class="activity-rail" aria-label="Workspace panels">
			<button
				type="button"
				title="Explorer"
				aria-label="Toggle explorer"
				aria-pressed={
					sidebarOpen() &&
					!props.sourceControlOpen() &&
					!props.runAndDebugOpen() &&
					!workspaceSearchOpen()
				}
				onClick={props.onExplorer}
			>
				<ExplorerIcon size={26} nobox aria-hidden="true" />
			</button>
			<button
				type="button"
				title="Search workspace (Ctrl+Shift+F)"
				aria-label="Search workspace"
				aria-pressed={workspaceSearchOpen() && sidebarOpen()}
				onClick={() => {
					if (workspaceSearchOpen() && sidebarOpen()) {
						setWorkspaceSearchOpen(false);
						props.setSidebarOpen(false);
					} else props.openWorkspaceSearch();
				}}
			>
				<SearchIcon size={26} nobox aria-hidden="true" />
			</button>
			<button
				type="button"
				title="Source control"
				aria-label="Source control"
				aria-pressed={props.sourceControlOpen()}
				onClick={props.onSourceControl}
			>
				<GitIcon size={26} nobox aria-hidden="true" />
			</button>
			<button
				type="button"
				title="Run and Debug (Ctrl+Shift+D)"
				aria-label="Run and Debug"
				aria-pressed={props.runAndDebugOpen()}
				onClick={props.onRunAndDebug}
			>
				<DebugIcon size={26} nobox aria-hidden="true" />
			</button>
		</nav>
	);
}
