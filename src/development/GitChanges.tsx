import { For, Show } from "solid-js";
import AddIcon from "../icons/actions/add.svg";
import RemoveIcon from "../icons/actions/remove.svg";
import FileIcon from "../icons/files/file.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import ActionButton from "../workbench/ActionButton";
import type { GitChange } from "./git";

export default function GitChanges(props: {
	staged: boolean;
	changes: GitChange[];
	busy: boolean;
	onReview: (change: GitChange) => void;
	onStage: (change: GitChange) => void;
	onUnstage: (change: GitChange) => void;
}) {
	const status = (change: GitChange) =>
		props.staged
			? change.stage === 0
				? "D"
				: change.head === 0
					? "A"
					: "M"
			: change.worktree === 0
				? "D"
				: change.head === 0 && change.stage === 0
					? "?"
					: "M";
	return (
		<Show when={props.changes.length}>
			<details class="git-change-group" open>
				<summary>
					<ChevronIcon size={14} nobox aria-hidden="true" />
					{props.staged ? "Staged changes" : "Changes"}
					<span class="git-count">{props.changes.length}</span>
				</summary>
				<ul>
					<For each={props.changes}>
						{(change) => (
							<li class="git-change">
								<button
									type="button"
									class="git-file"
									title={change.path}
									aria-label={`Review ${props.staged ? "staged " : ""}${change.path}`}
									onClick={() => props.onReview(change)}
								>
									<FileIcon
										size={18}
										nobox
										aria-hidden="true"
									/>
									<span class="git-file-name">
										{change.path.split("/").at(-1)}
									</span>
									<span class="git-file-directory">
										{change.path
											.split("/")
											.slice(0, -1)
											.join("/")}
									</span>
								</button>
								<span
									class="git-change-status"
									data-status={status(change)}
									title={
										status(change) === "?"
											? "Untracked"
											: status(change) === "A"
												? "Added"
												: status(change) === "D"
													? "Deleted"
													: "Modified"
									}
								>
									{status(change)}
								</span>
								<div class="git-file-actions">
									<ActionButton
										icon={
											props.staged ? RemoveIcon : AddIcon
										}
										label={`${props.staged ? "Unstage" : "Stage"} ${change.path}`}
										compact
										disabled={props.busy}
										onClick={() =>
											props.staged
												? props.onUnstage(change)
												: props.onStage(change)
										}
									/>
								</div>
							</li>
						)}
					</For>
				</ul>
			</details>
		</Show>
	);
}
