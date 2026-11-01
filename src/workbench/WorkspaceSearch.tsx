import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type { SearchMatch } from "../editor/core/search";
import { LineIndex } from "../editor/view/lineIndex";
import type { ExplorerEntry } from "../platform/host";
import type { WorkspaceHost } from "../platform/services";
import { type FolderMatch, searchFolders } from "../workspace/search";

export default function WorkspaceSearch(props: {
	host: WorkspaceHost;
	roots: readonly ExplorerEntry[];
	visible: boolean;
	focusRequest: number;
	busy: boolean;
	buffers: () => ReadonlyMap<string, string>;
	onOpen: (result: FolderMatch, match: SearchMatch) => Promise<void>;
	onApply: (result: FolderMatch, replacement: string) => Promise<void>;
	onClose: () => void;
}) {
	let input!: HTMLInputElement;
	const indexes = new WeakMap<FolderMatch, LineIndex>();
	const indexFor = (result: FolderMatch) => {
		let index = indexes.get(result);
		if (!index) {
			index = new LineIndex(result.text);
			indexes.set(result, index);
		}
		return index;
	};
	const [query, setQuery] = createSignal("");
	const [replacement, setReplacement] = createSignal("");
	const [exclusions, setExclusions] = createSignal(
		"**/node_modules/**, **/.git/**, **/dist/**",
	);
	const [matchCase, setMatchCase] = createSignal(false);
	const [wholeWord, setWholeWord] = createSignal(false);
	const [running, setRunning] = createSignal(false);
	const [results, setResults] = createSignal<FolderMatch[]>([]);
	const [preview, setPreview] = createSignal(false);
	const [message, setMessage] = createSignal("");
	let controller: AbortController | undefined;
	createEffect(
		on(
			() => props.focusRequest,
			() => {
				if (props.visible) {
					input.focus();
					input.select();
				}
			},
		),
	);
	const invalidate = () => {
		controller?.abort();
		setResults([]);
		setPreview(false);
	};
	onCleanup(() => controller?.abort());
	const rootKey = createMemo(() =>
		props.roots.map((root) => root.id).join("\0"),
	);
	createEffect(
		on(
			rootKey,
			() => {
				invalidate();
				setMessage("Workspace folders changed. Search again.");
			},
			{ defer: true },
		),
	);
	const search = async () => {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		setRunning(true);
		setPreview(false);
		setResults([]);
		setMessage("Searching…");
		try {
			const summary = await searchFolders(
				props.host,
				props.roots,
				query(),
				{ matchCase: matchCase(), wholeWord: wholeWord() },
				exclusions(),
				props.buffers(),
				current.signal,
				(result) => {
					if (!current.signal.aborted)
						setResults((previous) => [...previous, result]);
				},
			);
			if (!current.signal.aborted)
				setMessage(
					`${summary.files} files searched; ${summary.skipped} binary, large, or unreadable files skipped.${summary.limited ? " Result or memory limit reached; narrow the query." : ""}`,
				);
		} catch (error) {
			if (controller !== current) return;
			if (current.signal.aborted)
				setMessage("Search cancelled. Results are partial.");
			else
				setMessage(
					error instanceof Error ? error.message : String(error),
				);
		} finally {
			if (controller === current) setRunning(false);
		}
	};
	const apply = async () => {
		const current = new AbortController();
		controller = current;
		setRunning(true);
		let applied = 0;
		try {
			for (const result of results()) {
				current.signal.throwIfAborted();
				await props.onApply(result, replacement());
				applied++;
			}
			setResults([]);
			setPreview(false);
			setMessage(
				`${applied} files updated in open buffers. Save files to write them to disk.`,
			);
		} catch (error) {
			setResults([]);
			setPreview(false);
			setMessage(
				`${applied} files updated; stopped: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setRunning(false);
		}
	};
	return (
		<Show when={props.visible}>
			<section
				class="workspace-search"
				aria-label="Workspace search"
				style={{
					"max-height": "40vh",
					overflow: "auto",
					"flex-shrink": 0,
				}}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void search();
					}}
				>
					<label>
						Search folder{" "}
						<input
							ref={input}
							value={query()}
							onInput={(event) => {
								invalidate();
								setQuery(event.currentTarget.value);
							}}
						/>
					</label>
					<label>
						Exclude patterns{" "}
						<input
							value={exclusions()}
							onInput={(event) => {
								invalidate();
								setExclusions(event.currentTarget.value);
							}}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={matchCase()}
							onChange={(event) => {
								invalidate();
								setMatchCase(event.currentTarget.checked);
							}}
						/>{" "}
						Match case
					</label>
					<label>
						<input
							type="checkbox"
							checked={wholeWord()}
							onChange={(event) => {
								invalidate();
								setWholeWord(event.currentTarget.checked);
							}}
						/>{" "}
						Whole word
					</label>
					<button
						type="submit"
						disabled={
							running() ||
							props.busy ||
							!query() ||
							!props.roots.length
						}
					>
						Search folders
					</button>
					<button
						type="button"
						disabled={!running()}
						onClick={() => controller?.abort()}
					>
						Cancel search
					</button>
					<label>
						Folder replacement{" "}
						<input
							disabled={running()}
							value={replacement()}
							onInput={(event) => {
								setReplacement(event.currentTarget.value);
								setPreview(false);
							}}
						/>
					</label>
					<button
						type="button"
						disabled={running() || !results().length || props.busy}
						onClick={() => setPreview(true)}
					>
						Preview replacements
					</button>
					<Show when={preview()}>
						<button
							type="button"
							disabled={running() || props.busy}
							onClick={() => void apply()}
						>
							Apply preview to buffers
						</button>
					</Show>
					<button
						type="button"
						onClick={() => {
							controller?.abort();
							props.onClose();
						}}
					>
						Close workspace search
					</button>
				</form>
				<p role="status">{message()}</p>
				<For each={results()}>
					{(result) => (
						<details open>
							<summary>
								{result.path} ({result.matches.length})
							</summary>
							<For each={result.matches.slice(0, 100)}>
								{(match) => {
									const lines = indexFor(result);
									const line = lines.lineAt(match.from);
									return (
										<div>
											<button
												type="button"
												disabled={
													running() || props.busy
												}
												onClick={() =>
													void props
														.onOpen(result, match)
														.catch((error) =>
															setMessage(
																String(error),
															),
														)
												}
											>
												{line + 1}:
												{match.from -
													lines.starts[line] +
													1}{" "}
												{lines.line(line).slice(0, 160)}
											</button>
										</div>
									);
								}}
							</For>
							<Show when={preview()}>
								<details>
									<summary>
										Review all {result.matches.length}{" "}
										replacements
									</summary>
									<For each={result.matches}>
										{(match) => {
											const index = indexFor(result);
											const line = index.lineAt(
												match.from,
											);
											return (
												<pre>{`${line + 1}:${match.from - index.starts[line] + 1}\n- ${result.text.slice(match.from, match.to)}\n+ ${replacement()}`}</pre>
											);
										}}
									</For>
								</details>
							</Show>
						</details>
					)}
				</For>
			</section>
		</Show>
	);
}
