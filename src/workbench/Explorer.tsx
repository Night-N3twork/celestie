import { createEffect, createSignal, For, on, Show } from "solid-js";
import FileIcon from "../icons/files/file.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import ExplorerIcon from "../icons/panels/explorer.svg";
import type { BrowserFileHost } from "../platform/browser/fileHost";
import type { ExplorerEntry } from "../platform/host";

export default function Explorer(props: {
	entry: ExplorerEntry;
	host: BrowserFileHost;
	disabled: boolean;
	onOpen: (entry: ExplorerEntry) => void;
	isExpanded: (id: string) => boolean;
	onExpanded: (id: string, expanded: boolean) => void;
}) {
	const expanded = () => props.isExpanded(props.entry.id);
	const [entries, setEntries] = createSignal<ExplorerEntry[]>();
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const load = async () => {
		if (entries() || loading()) return;
		setLoading(true);
		try {
			setEntries(await props.host.readDirectory(props.entry.id));
			setError("");
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setLoading(false);
		}
	};
	createEffect(
		on(expanded, (value) => {
			if (value && props.entry.kind === "directory") void load();
		}),
	);
	const toggle = () => {
		if (props.entry.kind === "file") return props.onOpen(props.entry);
		props.onExpanded(props.entry.id, !expanded());
	};
	return (
		<li>
			<button
				type="button"
				class="explorer-entry"
				disabled={props.disabled || loading()}
				aria-expanded={
					props.entry.kind === "directory" ? expanded() : undefined
				}
				onClick={() => void toggle()}
			>
				<Show
					when={props.entry.kind === "directory"}
					fallback={<FileIcon size={20} nobox aria-hidden="true" />}
				>
					<ChevronIcon
						size={20}
						nobox
						aria-hidden="true"
						style={{
							transform: expanded()
								? "rotate(90deg)"
								: "rotate(0deg)",
						}}
					/>
					<ExplorerIcon size={20} nobox aria-hidden="true" />
				</Show>
				{props.entry.name}
			</button>
			<Show when={expanded()}>
				<Show when={loading()}>
					<p>Loading…</p>
				</Show>
				<Show when={error()}>
					<p role="alert">{error()}</p>
				</Show>
				<ul>
					<For each={entries()}>
						{(entry) => (
							<Explorer
								entry={entry}
								host={props.host}
								disabled={props.disabled}
								onOpen={props.onOpen}
								isExpanded={props.isExpanded}
								onExpanded={props.onExpanded}
							/>
						)}
					</For>
				</ul>
			</Show>
		</li>
	);
}
