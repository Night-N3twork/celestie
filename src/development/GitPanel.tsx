import { createEffect, createSignal, For, on, Show } from "solid-js";
import RefreshIcon from "../icons/actions/refresh.svg";
import ActionButton from "../workbench/ActionButton";
import * as git from "./git";
export default function GitPanel(props: {
	root: string;
	onOpen: (id: string) => void;
}) {
	const [changes, setChanges] = createSignal<git.GitChange[]>([]);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");
	const [name, setName] = createSignal(
		localStorage.getItem("celestie.git.name") ?? "",
	);
	const [email, setEmail] = createSignal(
		localStorage.getItem("celestie.git.email") ?? "",
	);
	const [preview, setPreview] = createSignal<{
		path: string;
		before: string;
		after: string;
	}>();
	let generation = 0;
	const perform = async (action: () => Promise<unknown>) => {
		if (busy()) return;
		setBusy(true);
		setError("");
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
		const result = await git.changes(root);
		if (current === generation && root === props.root) setChanges(result);
	};
	createEffect(
		on(
			() => props.root,
			() => {
				setPreview(undefined);
				setChanges([]);
				void perform(refresh);
			},
		),
	);
	return (
		<section class="git-panel" aria-label="Source control">
			<div class="development-actions">
				<ActionButton
					icon={RefreshIcon}
					label="Refresh changes"
					disabled={busy()}
					onClick={() => void perform(refresh)}
				/>
				<button
					type="button"
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
			<Show when={error()}>
				<p role="alert">{error()}</p>
			</Show>
			<ul>
				<For each={changes()}>
					{(change) => (
						<li>
							<button
								type="button"
								onClick={() =>
									props.onOpen(`${props.root}/${change.path}`)
								}
							>
								{change.path}
							</button>
							<span>
								{change.head !== change.stage
									? "staged"
									: "unstaged"}
							</span>
							<button
								disabled={busy()}
								type="button"
								onClick={() =>
									void perform(async () =>
										setPreview({
											path: change.path,
											...(await git.diff(
												props.root,
												change.path,
											)),
										}),
									)
								}
							>
								Review
							</button>
							<button
								disabled={busy()}
								type="button"
								onClick={() =>
									void perform(async () => {
										await git.stage(props.root, change);
										await refresh();
									})
								}
							>
								Stage
							</button>
							<button
								disabled={
									busy() || change.head === change.stage
								}
								type="button"
								onClick={() =>
									void perform(async () => {
										await git.unstage(
											props.root,
											change.path,
										);
										await refresh();
									})
								}
							>
								Unstage
							</button>
						</li>
					)}
				</For>
			</ul>
			<Show when={preview()}>
				{(value) => (
					<details open>
						<summary>{value().path}</summary>
						<div class="diff-preview">
							<section>
								<h4>HEAD</h4>
								<pre>{value().before}</pre>
							</section>
							<section>
								<h4>Working file</h4>
								<pre>{value().after}</pre>
							</section>
						</div>
					</details>
				)}
			</Show>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void perform(async () => {
						const oid = await git.commit(
							props.root,
							message(),
							name(),
							email(),
						);
						localStorage.setItem("celestie.git.name", name());
						localStorage.setItem("celestie.git.email", email());
						setMessage("");
						setPreview(undefined);
						await refresh();
						setError(`Committed ${oid.slice(0, 8)}`);
					});
				}}
			>
				<label>
					Author
					<input
						required
						value={name()}
						onInput={(event) => setName(event.currentTarget.value)}
					/>
				</label>
				<label>
					Email
					<input
						type="email"
						required
						value={email()}
						onInput={(event) => setEmail(event.currentTarget.value)}
					/>
				</label>
				<label>
					Commit message
					<input
						required
						value={message()}
						onInput={(event) =>
							setMessage(event.currentTarget.value)
						}
					/>
				</label>
				<button
					type="submit"
					disabled={
						busy() ||
						!changes().some(
							(change) => change.head !== change.stage,
						)
					}
				>
					Commit staged changes
				</button>
			</form>
		</section>
	);
}
