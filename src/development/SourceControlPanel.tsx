import { lazy, Show } from "solid-js";
import type { DiffReview } from "../workbench/createDiffController";
import ToolWindowHeader from "../workbench/ToolWindowHeader";
import type { DevelopmentController } from "./createDevelopmentController";

const GitPanel = lazy(() => import("./GitPanel"));
export default function SourceControlPanel(props: {
	development: DevelopmentController;
	onHide: () => void;
	onReview: (review: DiffReview) => void;
	onOpenFolder: () => void;
}) {
	const d = props.development;
	return (
		<aside
			class="file-explorer source-control"
			aria-label="Source control sidebar"
		>
			<ToolWindowHeader title="Source control" onHide={props.onHide} />
			<Show
				when={d.root()}
				fallback={
					<div class="tool-empty">
						<p>Open a folder to use source control.</p>
						<button type="button" onClick={props.onOpenFolder}>
							Open folder
						</button>
					</div>
				}
			>
				<Show
					when={d.runtimeRoot()}
					keyed
					fallback={
						<p class="tool-empty">
							{d.error() || "Opening repository…"}
						</p>
					}
				>
					{(root) => (
						<GitPanel
							onReview={(review) =>
								props.onReview({
									...review,
									fileId: d.workspaceFile(review.fileId),
								})
							}
							root={root}
							name={d.root()?.name}
						/>
					)}
				</Show>
			</Show>
		</aside>
	);
}
