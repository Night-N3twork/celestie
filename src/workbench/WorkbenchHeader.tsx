import { type Accessor, onCleanup, onMount, Show } from "solid-js";
import MoreIcon from "../icons/actions/more.svg";
import LogoIcon from "../icons/logo.svg";
import SearchIcon from "../icons/panels/search.svg";
import { synchronizeTitlebar } from "../platform/desktop/titlebar";
import type { ExplorerEntry } from "../platform/host";
import ActionButton from "./ActionButton";

interface Props {
	folder: Accessor<ExplorerEntry | undefined>;
	run: (id: string) => Promise<unknown>;
}

export default function WorkbenchHeader(props: Props) {
	let header!: HTMLElement;
	onMount(() => onCleanup(synchronizeTitlebar(header)));
	const { folder, run } = props;
	return (
		<header
			ref={header}
			class="workbench-header"
			data-platform={window.celestie?.platform}
		>
			<div class="brand">
				<LogoIcon size={24} aria-hidden="true" />
				<span>celestie</span>
				<Show
					when={
						folder()?.name &&
						folder()?.name.toLowerCase() !== "celestie"
					}
				>
					<span class="brand-divider" />
					<span class="workspace-name">{folder()?.name}</span>
				</Show>
			</div>
			<button
				type="button"
				class="quick-open"
				aria-label="Quick open"
				title="Go to file (Ctrl+P)"
				onClick={() => void run("navigation.files")}
			>
				<SearchIcon size={18} nobox aria-hidden="true" />
				<span>Go to file…</span>
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
