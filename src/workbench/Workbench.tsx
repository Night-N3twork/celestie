import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CommandRegistry } from "../commands/registry";
import Editor from "../editor/view/Editor";
import CloseIcon from "../icons/actions/close.svg";
import UnsavedIcon from "../icons/debug/breakpoint.svg";
import { BrowserFileHost } from "../platform/browser/fileHost";
import type { ExplorerEntry, TextFile } from "../platform/host";
import { defaultEditorSettings } from "../settings/editorSettings";
import { Workspace } from "../workspace/workspace";
import Explorer from "./Explorer";
import FindReplace, { type FindReplaceControl } from "./FindReplace";

const workspaceKey = "celestie.workspace.v1";
const legacyDraftKey = "celestie.draft.v1";
const explorerKey = "celestie.explorer.v1";

export default function Workbench() {
	const host = new BrowserFileHost();
	const commands = new CommandRegistry();
	let workspace = new Workspace();
	const [revision, setRevision] = createSignal(0);
	const [settings, setSettings] = createSignal(defaultEditorSettings);
	const [message, setMessage] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [searchOpen, setSearchOpen] = createSignal(false);
	const [replaceOpen, setReplaceOpen] = createSignal(false);
	const [searchFocus, setSearchFocus] = createSignal(0);
	const [editorFocus, setEditorFocus] = createSignal(0);
	const [revealRequest, setRevealRequest] = createSignal(0);
	const [selectionRevision, setSelectionRevision] = createSignal(0);
	let searchControl: FindReplaceControl | undefined;
	const [folder, setFolder] = createSignal<ExplorerEntry>();
	const [folderAccessible, setFolderAccessible] = createSignal(true);
	const [expandedDirectories, setExpandedDirectories] = createSignal(
		new Set<string>(),
	);
	const isExpanded = (id: string) => expandedDirectories().has(id);
	const onExpanded = (id: string, expanded: boolean) => {
		const next = new Set(expandedDirectories());
		if (expanded) next.add(id);
		else next.delete(id);
		setExpandedDirectories(next);
		try {
			localStorage.setItem(
				explorerKey,
				JSON.stringify({ root: folder()?.id, expanded: [...next] }),
			);
		} catch {
			setMessage("Expanded folders could not be saved.");
		}
	};
	let untitledCount = 0;
	const file = () => {
		revision();
		return workspace.active;
	};
	const documents = () => {
		revision();
		return workspace.documents;
	};
	const dirty = () => {
		revision();
		return workspace.dirty;
	};
	const documentDirty = (document: { dirty: boolean }) => {
		revision();
		return document.dirty;
	};
	const persist = () => {
		try {
			localStorage.setItem(workspaceKey, workspace.serialize());
		} catch {
			setMessage("Browser storage error.");
		}
	};
	const changed = () => {
		setRevision((value) => value + 1);
		persist();
	};
	const openSearch = (replace: boolean) => {
		setReplaceOpen(replace);
		setSearchOpen(true);
		setSearchFocus((value) => value + 1);
	};
	commands.register({
		id: "search.find",
		title: "Find",
		execute: () => openSearch(false),
	});
	commands.register({
		id: "search.replace",
		title: "Find and replace",
		execute: () => openSearch(true),
	});
	for (const backwards of [false, true])
		commands.register({
			id: backwards ? "search.previous" : "search.next",
			title: backwards ? "Previous match" : "Next match",
			execute: () => {
				if (!searchControl?.hasQuery()) {
					openSearch(false);
					return;
				}
				setSearchOpen(true);
				searchControl.next(backwards);
			},
		});
	const open = (file: TextFile) => {
		host.remember(file);
		workspace.open(file);
		changed();
	};
	const newFile = () => {
		untitledCount++;
		open({
			id: crypto.randomUUID(),
			name: `untitled-${untitledCount}.txt`,
			text: "",
		});
	};
	const close = (id: string) => {
		if (busy()) return;
		const document = workspace.documents.find(
			(document) => document.id === id,
		);
		if (!document) return;
		if (
			document.dirty &&
			!window.confirm(
				`Discard unsaved changes in ${document.name}? Cancel to keep it open and save first.`,
			)
		)
			return;
		workspace.close(id, true);
		changed();
	};
	commands.register({ id: "file.new", title: "New", execute: newFile });
	commands.register({
		id: "file.open",
		title: "Open",
		execute: async () => {
			const opened = await host.openTextFile();
			if (opened) {
				open(opened);
				setMessage(`Opened ${opened.name}`);
			}
		},
	});
	commands.register({
		id: "folder.open",
		title: "Open folder",
		execute: async () => {
			const opened = await host.openFolder();
			if (opened) {
				setFolder(opened);
				setFolderAccessible(true);
				setExpandedDirectories(new Set<string>());
				onExpanded(opened.id, true);
				setMessage(
					host.folderPersistenceError ||
						`Opened folder ${opened.name}`,
				);
			}
		},
	});
	commands.register({
		id: "file.save",
		title: "Save",
		execute: async () => {
			const document = file();
			if (!document) return;
			await document.save(host);
			setMessage(`Saved ${document.name}`);
			changed();
		},
	});
	commands.register({
		id: "file.download",
		title: "Download copy",
		execute: () => {
			const document = file();
			if (!document) return;
			host.download({
				id: document.id,
				name: document.name,
				text: document.editor.snapshot.text,
			});
			setMessage("Download requested.");
		},
	});
	for (const action of ["undo", "redo"] as const)
		commands.register({
			id: `edit.${action}`,
			title: action,
			execute: () => {
				file()?.editor[action]();
				changed();
			},
		});
	const perform = async (action: () => void | Promise<void>) => {
		if (busy()) return;
		setBusy(true);
		try {
			await action();
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError"))
				setMessage(
					error instanceof Error ? error.message : String(error),
				);
		} finally {
			setBusy(false);
		}
	};
	const run = (id: string) => {
		if (!id.startsWith("search."))
			return perform(() => commands.execute(id));
		if (busy()) return Promise.resolve();
		return commands
			.execute(id)
			.catch((error) =>
				setMessage(
					error instanceof Error ? error.message : String(error),
				),
			);
	};
	const openEntry = (entry: ExplorerEntry) =>
		void perform(async () => {
			if (
				workspace.documents.some((document) => document.id === entry.id)
			) {
				workspace.activate(entry.id);
				changed();
				return;
			}
			open(await host.readTextFile(entry.id));
		});
	onMount(() => {
		try {
			const raw = localStorage.getItem(workspaceKey);
			if (raw) {
				workspace = Workspace.restore(raw);
				for (const document of workspace.documents)
					host.remember(document);
				setRevision((value) => value + 1);
				if (workspace.documents.length) setMessage("Restored tabs.");
			} else {
				const legacy = localStorage.getItem(legacyDraftKey);
				if (legacy) {
					const draft = JSON.parse(legacy);
					if (
						typeof draft?.name === "string" &&
						typeof draft.text === "string" &&
						draft.dirty === true
					) {
						open({
							id: crypto.randomUUID(),
							name: draft.name,
							text: draft.text,
						});
						workspace.active?.markUnsaved();
						changed();
						setMessage("Recovered unsaved draft.");
					}
				}
				if (!workspace.documents.length) newFile();
			}
			untitledCount = workspace.documents.reduce(
				(count, file) =>
					Math.max(
						count,
						Number(
							/^untitled-(\d+)\.txt$/.exec(file.name)?.[1] ?? 0,
						),
					),
				untitledCount,
			);
		} catch {
			setMessage("Workspace could not be recovered.");
		}
		const unload = (event: BeforeUnloadEvent) => {
			if (workspace.dirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		const keydown = (event: KeyboardEvent) => {
			if (!event.isComposing && event.key === "F3") {
				event.preventDefault();
				void run(event.shiftKey ? "search.previous" : "search.next");
				return;
			}
			if (
				event.isComposing ||
				!(event.ctrlKey || event.metaKey) ||
				event.altKey
			)
				return;
			const key = event.key.toLowerCase();
			if (key === "f" || key === "h") {
				event.preventDefault();
				void run(key === "h" ? "search.replace" : "search.find");
				return;
			}
			const target = event.target;
			if (
				(key === "z" || key === "y") &&
				target instanceof HTMLElement &&
				!target.classList.contains("editor-input")
			)
				return;
			const id =
				key === "s"
					? "file.save"
					: key === "o"
						? event.shiftKey
							? "folder.open"
							: "file.open"
						: key === "z"
							? event.shiftKey
								? "edit.redo"
								: "edit.undo"
							: key === "y"
								? "edit.redo"
								: undefined;
			if (id) {
				event.preventDefault();
				void run(id);
			}
		};
		window.addEventListener("beforeunload", unload);
		window.addEventListener("keydown", keydown);
		onCleanup(() => {
			window.removeEventListener("beforeunload", unload);
			window.removeEventListener("keydown", keydown);
		});
		void perform(async () => {
			const restored = await host.restoreFolder();
			if (!restored) return;
			try {
				const stored = JSON.parse(
					localStorage.getItem(explorerKey) ?? "null",
				);
				setExpandedDirectories(
					new Set<string>(
						stored?.root === restored.entry.id &&
							Array.isArray(stored.expanded)
							? stored.expanded.filter(
									(id: unknown) => typeof id === "string",
								)
							: [restored.entry.id],
					),
				);
			} catch {
				setExpandedDirectories(new Set([restored.entry.id]));
			}
			setFolderAccessible(restored.accessible);
			setFolder(restored.entry);
			if (!restored.accessible)
				setMessage("Reconnect folder to restore file access.");
		});
	});
	return (
		<section class="workbench" aria-label="Editor workbench">
			<nav class="editor-toolbar" aria-label="File and edit commands">
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("folder.open")}
				>
					Open folder
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("file.new")}
				>
					New
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("file.open")}
				>
					Open
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("file.save")}
				>
					Save
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("file.download")}
				>
					Download copy
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("edit.undo")}
				>
					Undo
				</button>
				<button
					type="button"
					disabled={busy()}
					onClick={() => void run("edit.redo")}
				>
					Redo
				</button>

				<button
					type="button"
					disabled={busy() || !file()}
					onClick={() => void run("search.find")}
				>
					Find
				</button>
				<button
					type="button"
					disabled={busy() || !file()}
					onClick={() => void run("search.replace")}
				>
					Find and replace
				</button>
				<label>
					Font{" "}
					<input
						type="number"
						min="10"
						max="32"
						value={settings().fontSize}
						onInput={(event) => {
							const size = event.currentTarget.valueAsNumber;
							if (
								Number.isInteger(size) &&
								size >= 10 &&
								size <= 32
							)
								setSettings({ ...settings(), fontSize: size });
						}}
					/>
				</label>
				<label>
					Tab size{" "}
					<select
						value={settings().tabSize}
						onChange={(event) =>
							setSettings({
								...settings(),
								tabSize: Number(event.currentTarget.value),
							})
						}
					>
						<option value="2">2</option>
						<option value="4">4</option>
						<option value="8">8</option>
					</select>
				</label>
				<label>
					<input
						type="checkbox"
						checked={settings().insertSpaces}
						onChange={(event) =>
							setSettings({
								...settings(),
								insertSpaces: event.currentTarget.checked,
							})
						}
					/>{" "}
					Spaces
				</label>
				<label>
					<input
						type="checkbox"
						checked={settings().lineNumbers}
						onChange={(event) =>
							setSettings({
								...settings(),
								lineNumbers: event.currentTarget.checked,
							})
						}
					/>{" "}
					Line numbers
				</label>
			</nav>
			<FindReplace
				session={file()?.editor}
				revision={revision()}
				selectionRevision={selectionRevision()}
				visible={searchOpen()}
				showReplace={replaceOpen()}
				focusRequest={searchFocus()}
				disabled={busy()}
				onReady={(control) => {
					searchControl = control;
				}}
				onUpdate={() => {
					setRevealRequest((value) => value + 1);
					setSelectionRevision((value) => value + 1);
					changed();
				}}
				onClose={() => {
					setSearchOpen(false);
					setEditorFocus((value) => value + 1);
				}}
			/>
			<div class="workspace-body">
				<Show when={folder()} keyed>
					{(root) => (
						<aside class="file-explorer" aria-label="File explorer">
							<Show
								when={folderAccessible()}
								fallback={
									<>
										<p>{root.name}</p>
										<button
											type="button"
											disabled={busy()}
											onClick={() =>
												void perform(async () => {
													const granted =
														await host.reconnectFolder(
															root.id,
														);
													setFolderAccessible(
														granted,
													);
													setMessage(
														granted
															? ""
															: "Folder access was not granted.",
													);
												})
											}
										>
											Reconnect folder
										</button>
									</>
								}
							>
								<ul>
									<Explorer
										entry={root}
										host={host}
										disabled={busy()}
										onOpen={openEntry}
										isExpanded={isExpanded}
										onExpanded={onExpanded}
									/>
								</ul>
							</Show>
						</aside>
					)}
				</Show>
				<div class="workspace-editor">
					<fieldset class="editor-tabs" aria-label="Open files">
						<For each={documents()}>
							{(document) => (
								<div
									class="editor-tab"
									classList={{
										active: file()?.id === document.id,
									}}
								>
									<button
										type="button"
										disabled={busy()}
										aria-pressed={
											file()?.id === document.id
										}
										onClick={() => {
											workspace.activate(document.id);
											changed();
										}}
									>
										{document.name}
										<Show when={documentDirty(document)}>
											<UnsavedIcon
												size={16}
												nobox
												title="Unsaved changes"
												role="img"
												aria-label="Unsaved changes"
											/>
										</Show>
									</button>
									<button
										type="button"
										disabled={busy()}
										aria-label={`Close ${document.name}`}
										onClick={() => close(document.id)}
									>
										<CloseIcon
											size={18}
											nobox
											aria-hidden="true"
										/>
									</button>
								</div>
							)}
						</For>
					</fieldset>
					<Show
						when={file()}
						keyed
						fallback={
							<div class="editor-empty">
								Open or create a new file to start editing.
							</div>
						}
					>
						{(document) => (
							<Editor
								session={document.editor}
								revision={revision()}
								settings={settings()}
								readOnly={busy()}
								onChange={changed}
								onSelectionChange={() => {
									setSelectionRevision((value) => value + 1);
									persist();
								}}
								revealRequest={revealRequest()}
								focusRequest={editorFocus()}
							/>
						)}
					</Show>
				</div>
			</div>
			<footer class="editor-status" role="status">
				{message() ? `${message()} - ` : ""}
				{dirty() ? "Unsaved changes" : "No unsaved changes"}
			</footer>
		</section>
	);
}
