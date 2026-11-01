import type { Accessor } from "solid-js";
import MoreIcon from "../icons/actions/more.svg";
import LogoIcon from "../icons/logo.svg";
import SearchIcon from "../icons/panels/search.svg";
import type { ExplorerEntry } from "../platform/host";
import ActionButton from "./ActionButton";

interface Props {
	folder: Accessor<ExplorerEntry | undefined>;
	run: (id: string) => Promise<unknown>;
}

export default function WorkbenchHeader(props: Props) {
	const { folder, run } = props;
	return (
		<header class="workbench-header">
			<div class="brand">
				<LogoIcon size={28} aria-hidden="true" />
				<span>celestie</span>
				<span class="brand-divider" />
				<span class="workspace-name">
					{folder()?.name ?? "Workspace"}
				</span>
			</div>
			<button
				type="button"
				class="quick-open"
				aria-label="Quick open"
				title="Quick open (Ctrl+P)"
				onClick={() => void run("navigation.files")}
			>
				<SearchIcon size={24} nobox aria-hidden="true" />
				<span>Search files…</span>
				<kbd>Ctrl P</kbd>
			</button>
			<ActionButton
				label="Commands"
				icon={MoreIcon}
				onClick={() => void run("navigation.commands")}
			/>
		</header>
	);
}
