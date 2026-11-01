import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import MoreIcon from "../icons/actions/more.svg";
import RefreshIcon from "../icons/actions/refresh.svg";
import NewFileIcon from "../icons/files/new-file.svg";
import NewFolderIcon from "../icons/files/new-folder.svg";
import ExplorerIcon from "../icons/panels/explorer.svg";
import type { ExplorerEntry } from "../platform/host";
import type { WorkspaceHost } from "../platform/services";
import ActionButton from "./ActionButton";
import Explorer from "./Explorer";

interface Props {
	busy: Accessor<boolean>;
	folders: Accessor<{ entry: ExplorerEntry; accessible: boolean }[]>;
	manageEntry: (
		action: "file" | "directory" | "rename" | "move" | "delete",
	) => Promise<void>;
	refreshExplorer: () => void;
	selectedEntry: Accessor<ExplorerEntry | undefined>;
	run: (id: string) => Promise<unknown>;
	perform: (action: () => void | Promise<void>) => Promise<void>;
	host: WorkspaceHost;
	setFolders: Setter<{ entry: ExplorerEntry; accessible: boolean }[]>;
	setSelectedEntry: Setter<ExplorerEntry | undefined>;
	openEntry: (entry: ExplorerEntry) => void;
	isExpanded: (id: string) => boolean;
	onExpanded: (id: string, expanded: boolean) => void;
	explorerRevision: Accessor<number>;
}

export default function ExplorerPanel(props: Props) {
	const {
		busy,
		folders,
		manageEntry,
		refreshExplorer,
		selectedEntry,
		run,
		perform,
		host,
		setFolders,
		setSelectedEntry,
		openEntry,
		isExpanded,
		onExpanded,
		explorerRevision,
	} = props;
	return (
		<aside class="file-explorer" aria-label="File explorer">
			<header class="explorer-header">
				<span>Explorer</span>
				<div class="explorer-actions">
					<ActionButton
						label="Create file"
						icon={NewFileIcon}
						compact
						disabled={busy() || !folders().length}
						onClick={() => void manageEntry("file")}
					/>
					<ActionButton
						label="Create folder"
						icon={NewFolderIcon}
						compact
						disabled={busy() || !folders().length}
						onClick={() => void manageEntry("directory")}
					/>
					<ActionButton
						label="Refresh explorer"
						icon={RefreshIcon}
						compact
						disabled={busy()}
						onClick={refreshExplorer}
					/>
					<details
						class="entry-menu"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								event.currentTarget.open = false;
								event.currentTarget
									.querySelector("summary")
									?.focus();
							}
						}}
						onClick={(event) => {
							if ((event.target as Element).closest("button"))
								event.currentTarget.open = false;
						}}
					>
						<summary title="File actions">
							<MoreIcon size={24} nobox aria-hidden="true" />
							<span class="sr-only">File actions</span>
						</summary>
						<div>
							<button
								type="button"
								disabled={busy() || !selectedEntry()}
								onClick={() => void manageEntry("rename")}
							>
								Rename
							</button>
							<button
								type="button"
								disabled={busy() || !selectedEntry()}
								onClick={() => void manageEntry("move")}
							>
								Move entry
							</button>
							<button
								type="button"
								class="destructive"
								disabled={busy() || !selectedEntry()}
								onClick={() => void manageEntry("delete")}
							>
								Delete
							</button>
						</div>
					</details>
				</div>
			</header>
			<Show when={selectedEntry()}>
				<p class="explorer-selection" title={selectedEntry()?.id}>
					{selectedEntry()?.name}
				</p>
			</Show>
			<Show when={!folders().length}>
				<div class="explorer-empty">
					<ExplorerIcon size={48} nobox aria-hidden="true" />
					<strong>No folder open</strong>
					<p>Open a folder to browse your project.</p>
					<button
						type="button"
						class="primary"
						aria-label="Open project folder"
						onClick={() => void run("folder.open")}
					>
						Open folder
					</button>
				</div>
			</Show>
			<div class="explorer-tree">
				<For each={folders()}>
					{(root) => (
						<div class="workspace-root">
							<button
								type="button"
								class="root-remove"
								aria-label={`Remove folder ${root.entry.name}`}
								title={`Remove ${root.entry.name} from workspace`}
								disabled={busy()}
								onClick={() =>
									void perform(async () => {
										await host.removeRoot(root.entry.id);
										setFolders((previous) =>
											previous.filter(
												(item) =>
													item.entry.id !==
													root.entry.id,
											),
										);
										setSelectedEntry(undefined);
									})
								}
							>
								<CloseIcon size={20} nobox aria-hidden="true" />
							</button>
							<Show
								when={root.accessible}
								fallback={
									<div class="workspace-root">
										<p>{root.entry.name}</p>
										<button
											type="button"
											disabled={busy()}
											onClick={() =>
												void perform(async () => {
													const granted =
														await host.reconnectFolder(
															root.entry.id,
														);
													setFolders((previous) =>
														previous.map((item) =>
															item.entry.id ===
															root.entry.id
																? {
																		...item,
																		accessible:
																			granted,
																	}
																: item,
														),
													);
												})
											}
										>
											Reconnect {root.entry.name}
										</button>
									</div>
								}
							>
								<ul>
									<Explorer
										entry={root.entry}
										host={host}
										disabled={busy()}
										onOpen={openEntry}
										selectedId={selectedEntry()?.id}
										isExpanded={isExpanded}
										onExpanded={onExpanded}
										revision={explorerRevision()}
										onSelect={setSelectedEntry}
									/>
								</ul>
							</Show>
						</div>
					)}
				</For>
			</div>
		</aside>
	);
}
