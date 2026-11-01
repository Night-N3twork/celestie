import { lazy, Show } from "solid-js";
import type { DevelopmentController } from "./createDevelopmentController";

const GitPanel = lazy(() => import("./GitPanel"));
export default function SourceControlPanel(props: {
	development: DevelopmentController;
	onOpen: (id: string) => void;
}) {
	const d = props.development;
	return (
		<aside
			class="file-explorer source-control"
			aria-label="Source control sidebar"
		>
			<header class="explorer-header">
				<span>Source control</span>
			</header>
			<Show
				when={d.root()}
				fallback={<p>Open a folder to use source control.</p>}
			>
				<Show
					when={d.runtimeRoot()}
					keyed
					fallback={<p>{d.error() || "Opening repository…"}</p>}
				>
					{(root) => (
						<GitPanel
							root={root}
							onOpen={(id) => props.onOpen(d.workspaceFile(id))}
						/>
					)}
				</Show>
			</Show>
		</aside>
	);
}
