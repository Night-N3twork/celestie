import { createEffect, createSignal, For, on, Show } from "solid-js";
import RefreshIcon from "../icons/actions/refresh.svg";
import CommitIcon from "../icons/git/commit.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import ActionButton from "../workbench/ActionButton";
import type { DiffReview } from "../workbench/createDiffController";
import ToolSection from "../workbench/ToolSection";
import GitChanges from "./GitChanges";
import * as git from "./git";

export default function GitPanel(props: {
	root: string;
	name?: string;
	onReview: (review: DiffReview) => void;
}) {
	const [changes, setChanges] = createSignal<git.GitChange[]>([]);
	const [initialized, setInitialized] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const [notice, setNotice] = createSignal("");
	const [message, setMessage] = createSignal("");
	const [name, setName] = createSignal(
		localStorage.getItem("celestie.git.name") ?? "",
	);
	const [email, setEmail] = createSignal(
		localStorage.getItem("celestie.git.email") ?? "",
	);
	const [authorOpen, setAuthorOpen] = createSignal(false);
	let generation = 0;
	const perform = async (action: () => Promise<unknown>) => {
		if (busy()) return;
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await action();
		} catch (error) {
			setError(String(error));
		} finally {
			setBusy(false);
		}
	};
	const refresh = async () => {
		const current = ++generation,
			root = props.root;
		const exists = await git.isRepository(root);
		const result = exists ? await git.changes(root) : [];
		if (current === generation && root === props.root) {
			setInitialized(exists);
			setChanges(result);
		}
	};
	const staged = () =>
		changes().filter((change) => change.head !== change.stage);
	const unstaged = () =>
		changes().filter((change) => change.worktree !== change.stage);
	createEffect(
		on(
			() => props.root,
			() => {
				setChanges([]);
				void perform(refresh);
			},
		),
	);
	return (
		<section class="git-panel" aria-label="Source control">
			<div class="git-panel-actions">
				<span>
					{busy()
						? "Updating…"
						: initialized()
							? props.name || "Repository"
							: "No repository"}
				</span>
				<ActionButton
					icon={RefreshIcon}
					label="Refresh changes"
					compact
					disabled={busy()}
					onClick={() => void perform(refresh)}
				/>
			</div>
			<Show when={error()}>
				<p class="git-notice" role="alert">
					{error()}
				</p>
			</Show>
			<Show when={notice()}>
				<p class="git-notice" role="status">
					{notice()}
				</p>
			</Show>
			<Show
				when={initialized()}
				fallback={
					<div class="tool-empty">
						<p>Initialize a repository to track this folder.</p>
						<button
							type="button"
							class="primary"
							disabled={busy()}
							onClick={() =>
								void perform(async () => {
									await git.initialize(props.root);
									await refresh();
								})
							}
						>
							Initialize repository
						</button>
					</div>
				}
			>
				<ToolSection title="Commit">
					<form
						class="git-commit-form"
						onSubmit={(event) => {
							event.preventDefault();
							if (!name().trim() || !email().trim()) {
								setAuthorOpen(true);
								setError("Set your name and email to commit.");
								return;
							}
							void perform(async () => {
								const oid = await git.commit(
									props.root,
									message(),
									name(),
									email(),
								);
								localStorage.setItem(
									"celestie.git.name",
									name(),
								);
								localStorage.setItem(
									"celestie.git.email",
									email(),
								);
								setMessage("");

								await refresh();
								setNotice(`Committed ${oid.slice(0, 8)}`);
							});
						}}
					>
						<label class="sr-only" for="git-message">
							Commit message
						</label>
						<input
							id="git-message"
							placeholder="Commit message"
							required
							value={message()}
							onInput={(event) =>
								setMessage(event.currentTarget.value)
							}
						/>
						<details
							class="git-author"
							open={authorOpen()}
							onToggle={(event) =>
								setAuthorOpen(event.currentTarget.open)
							}
						>
							<summary>
								<ChevronIcon
									size={14}
									nobox
									aria-hidden="true"
								/>
								Commit identity
							</summary>
							<label>
								Author
								<input
									value={name()}
									onInput={(event) =>
										setName(event.currentTarget.value)
									}
								/>
							</label>
							<label>
								Email
								<input
									type="email"
									onInvalid={() => setAuthorOpen(true)}
									value={email()}
									onInput={(event) =>
										setEmail(event.currentTarget.value)
									}
								/>
							</label>
						</details>
						<button
							type="submit"
							class="primary"
							aria-label="Commit staged changes"
							disabled={busy() || !staged().length}
						>
							<CommitIcon size={20} nobox aria-hidden="true" />
							Commit
						</button>
					</form>
				</ToolSection>
				<Show when={!changes().length && !busy()}>
					<p class="git-notice">No changes.</p>
				</Show>
				<For each={[true, false]}>
					{(stagedGroup) => (
						<GitChanges
							staged={stagedGroup}
							changes={stagedGroup ? staged() : unstaged()}
							busy={busy()}
							onReview={(change) =>
								void perform(async () =>
									props.onReview({
										id: `${props.root}/${change.path}#diff:${stagedGroup ? "staged" : "working"}`,
										fileId: `${props.root}/${change.path}`,
										path: change.path,
										...(await git.diff(
											props.root,
											change.path,
											stagedGroup,
										)),
										beforeLabel: stagedGroup
											? "HEAD"
											: "Index",
										afterLabel: stagedGroup
											? "Index"
											: "Working tree",
										canOpen: change.worktree !== 0,
									}),
								)
							}
							onStage={(change) =>
								void perform(async () => {
									await git.stage(props.root, change);
									await refresh();
								})
							}
							onUnstage={(change) =>
								void perform(async () => {
									await git.unstage(props.root, change.path);
									await refresh();
								})
							}
						/>
					)}
				</For>
			</Show>
		</section>
	);
}
