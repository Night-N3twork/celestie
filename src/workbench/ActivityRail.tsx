import type { Accessor, Setter } from "solid-js";
import ExplorerIcon from "../icons/panels/explorer.svg";
import SearchIcon from "../icons/panels/search.svg";

interface Props {
	sidebarOpen: Accessor<boolean>;
	setSidebarOpen: Setter<boolean>;
	workspaceSearchOpen: Accessor<boolean>;
	setWorkspaceSearchOpen: Setter<boolean>;
	setWorkspaceSearchFocus: Setter<number>;
}

export default function ActivityRail(props: Props) {
	const {
		sidebarOpen,
		setSidebarOpen,
		workspaceSearchOpen,
		setWorkspaceSearchOpen,
		setWorkspaceSearchFocus,
	} = props;
	return (
		<nav class="activity-rail" aria-label="Workspace panels">
			<button
				type="button"
				title="Explorer"
				aria-label="Toggle explorer"
				aria-pressed={sidebarOpen()}
				onClick={() => setSidebarOpen((value) => !value)}
			>
				<ExplorerIcon size={32} nobox aria-hidden="true" />
			</button>
			<button
				type="button"
				title="Search workspace (Ctrl+Shift+F)"
				aria-label="Search workspace"
				aria-pressed={workspaceSearchOpen()}
				onClick={() => {
					setWorkspaceSearchOpen((value) => !value);
					if (workspaceSearchOpen())
						setWorkspaceSearchFocus((value) => value + 1);
				}}
			>
				<SearchIcon size={32} nobox aria-hidden="true" />
			</button>
		</nav>
	);
}
