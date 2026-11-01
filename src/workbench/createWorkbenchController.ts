import { createSignal, onCleanup, onMount } from "solid-js";
import { CommandRegistry } from "../commands/registry";
import type { EditorSession } from "../editor/core/editor";
import { replaceMatches, type SearchMatch } from "../editor/core/search";
import type { EditorControl } from "../editor/view/Editor";
import { createLanguageService } from "../language/service";
import { WorkspaceFileHost } from "../platform/dusk/workspaceFileHost";
import type { ExplorerEntry, TextFile } from "../platform/host";
import { defaultEditorSettings } from "../settings/editorSettings";
import { WorkspaceLayout } from "../workspace/layout";
import { NavigationHistory } from "../workspace/navigation";
import type { FolderMatch } from "../workspace/search";
import { Workspace } from "../workspace/workspace";
import type { FindReplaceControl } from "./FindReplace";
import type { NavigationMode } from "./Navigator";
import { registerWorkbenchCommands } from "./registerWorkbenchCommands";
import { registerWorkbenchShortcuts } from "./registerWorkbenchShortcuts";

const workspaceKey = "celestie.workspace.v1";
const legacyDraftKey = "celestie.draft.v1";
const explorerKey = "celestie.explorer.v1";

export function createWorkbenchController() {
	const host = new WorkspaceFileHost();
	const commands = new CommandRegistry();
	const editorControls = new Map<EditorSession, EditorControl>();
	const history = new NavigationHistory();
	const [navigationMode, setNavigationMode] = createSignal<NavigationMode>();
	const [navigationFocus, setNavigationFocus] = createSignal(0);
	let workspace = new Workspace();
	let layout = new WorkspaceLayout();
	const [revision, setRevision] = createSignal(0);
	const [settings, setSettings] = createSignal(defaultEditorSettings);
	const [message, setMessage] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [sidebarOpen, setSidebarOpen] = createSignal(true);
	const [searchOpen, setSearchOpen] = createSignal(false);
	const [replaceOpen, setReplaceOpen] = createSignal(false);
	const [searchFocus, setSearchFocus] = createSignal(0);
	const [editorFocus, setEditorFocus] = createSignal(0);
	const [revealRequest, setRevealRequest] = createSignal(0);
	const [selectionRevision, setSelectionRevision] = createSignal(0);
	let searchControl: FindReplaceControl | undefined;
	const [folders, setFolders] = createSignal<
		{ entry: ExplorerEntry; accessible: boolean }[]
	>([]);
	const [selectedEntry, setSelectedEntry] = createSignal<ExplorerEntry>();
	const [explorerRevision, setExplorerRevision] = createSignal(0);
	const [workspaceSearchOpen, setWorkspaceSearchOpen] = createSignal(false);
	const [workspaceSearchFocus, setWorkspaceSearchFocus] = createSignal(0);
	const folder = () => folders().at(-1)?.entry;
	const refreshExplorer = () => {
		host.refresh();
		setExplorerRevision((value) => value + 1);
	};
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
	const documentName = (document: { name: string }) => {
		revision();
		return document.name;
	};
	const persist = () => {
		try {
			localStorage.setItem(workspaceKey, workspace.serialize());
			localStorage.setItem("celestie.layout.v1", layout.serialize());
		} catch {
			setMessage("Browser storage error.");
		}
	};
	const changed = () => {
		layout.prune(workspace.documents.map((document) => document.id));
		if (workspace.active) layout.show(workspace.active.id);
		setRevision((value) => value + 1);
		persist();
	};
	const openSearch = (replace: boolean) => {
		setReplaceOpen(replace);
		setSearchOpen(true);
		setSearchFocus((value) => value + 1);
	};

	const open = (file: TextFile) => {
		if (workspace.active)
			history.record({
				id: workspace.active.id,
				selection: workspace.active.editor.selection,
			});
		host.remember(file);
		workspace.open(file);
		history.record({
			id: file.id,
			selection: workspace.active?.editor.selection ?? {
				anchor: 0,
				head: 0,
			},
		});
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
	const manageEntry = (
		action: "file" | "directory" | "rename" | "move" | "delete",
	) =>
		perform(async () => {
			const entry = selectedEntry() ?? folder();
			if (!entry) return;
			const affected = workspace.documents.filter(
				(document) =>
					document.id === entry.id ||
					document.id.startsWith(`${entry.id}/`),
			);
			if (
				["rename", "move", "delete"].includes(action) &&
				affected.some((document) => document.dirty)
			)
				throw new Error(
					"Save or close unsaved files before moving or deleting their entries.",
				);
			if (action === "delete") {
				if (
					!window.confirm(
						`Permanently delete ${entry.name}${entry.kind === "directory" ? " and its contents" : ""}?`,
					)
				)
					return;
				await host.deleteEntry(entry);
				for (const document of affected)
					workspace.close(document.id, true);
				setSelectedEntry(undefined);
				changed();
			} else if (action === "rename" || action === "move") {
				const name =
					action === "rename"
						? window.prompt("New name", entry.name)
						: entry.name;
				if (!name) return;
				let parent = entry.id.slice(0, entry.id.lastIndexOf("/"));
				if (action === "move") {
					const root = folders().find((root) =>
						entry.id.startsWith(`${root.entry.id}/`),
					);
					if (!root)
						throw new Error("Select a file inside an open folder.");
					const path = window.prompt(
						"Destination folder path relative to this workspace root (empty for root)",
						"",
					);
					if (path === null) return;
					if (
						path
							.split(/[\\/]/)
							.some((part) => part === ".." || part === ".")
					)
						throw new Error("Use a folder path inside this root.");
					parent =
						root.entry.id +
						(path
							? `/${path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}`
							: "");
				}
				const target = await host.moveEntry(entry, parent, name);
				workspace.relocate(entry.id, target.id, target.name);
				history.relocate(entry.id, target.id);
				for (const group of layout.groups)
					if (
						group.documentId &&
						(group.documentId === entry.id ||
							group.documentId.startsWith(`${entry.id}/`))
					)
						group.documentId =
							target.id + group.documentId.slice(entry.id.length);
				if (target.kind === "file")
					open(await host.readTextFile(target.id));
				else onExpanded(target.id, true);
				changed();
				setSelectedEntry(target);
			} else {
				const parent =
					entry.kind === "directory"
						? entry.id
						: entry.id.slice(0, entry.id.lastIndexOf("/"));
				const name = window.prompt(
					action === "file" ? "New file name" : "New folder name",
				);
				if (!name) return;
				const created = await host.createEntry(parent, name, action);
				onExpanded(parent, true);
				setSelectedEntry(created);
				if (created.kind === "file")
					open(await host.readTextFile(created.id));
			}
			refreshExplorer();
		});
	const openSearchResult = async (
		result: FolderMatch,
		match: SearchMatch,
	) => {
		const known = workspace.documents.find(
			(document) => document.id === result.entry.id,
		);
		const current =
			known?.editor.snapshot.text ??
			(await host.readTextFile(result.entry.id)).text;
		if (
			current !== result.text ||
			workspace.documents.some(
				(document) =>
					document.id === result.entry.id &&
					document.editor.snapshot.text !== result.text,
			)
		)
			throw new Error(
				"Search result is stale. Search again before opening its range.",
			);
		open({ id: result.entry.id, name: result.entry.name, text: current });
		workspace.active?.editor.setSelection({
			anchor: match.from,
			head: match.to,
		});
		setRevealRequest((value) => value + 1);
		changed();
		setEditorFocus((value) => value + 1);
	};
	const applySearchResult = async (
		result: FolderMatch,
		replacement: string,
	) => {
		const known = workspace.documents.find(
			(document) => document.id === result.entry.id,
		);
		const current =
			known?.editor.snapshot.text ??
			(await host.readTextFile(result.entry.id)).text;
		if (
			current !== result.text ||
			workspace.documents.some(
				(document) =>
					document.id === result.entry.id &&
					document.editor.snapshot.text !== result.text,
			)
		)
			throw new Error(
				`${result.path} changed after preview. Search again.`,
			);
		const edit = replaceMatches(current, result.matches, replacement);
		if (!edit) return;
		open({ id: result.entry.id, name: result.entry.name, text: current });
		workspace.active?.editor.apply({ edit });
		changed();
	};

	const groupDocument = (id: string) => {
		revision();
		return workspace.documents.find(
			(document) =>
				document.id ===
				layout.groups.find((group) => group.id === id)?.documentId,
		);
	};
	const focusGroup = (id: string) => {
		layout.active = id;
		const document = groupDocument(id);
		if (document) workspace.activate(document.id);
		setRevision((value) => value + 1);
		persist();
	};
	const groups = () => {
		revision();
		return layout.groups;
	};
	const activeGroup = () => {
		revision();
		return layout.active;
	};
	const splitDirection = () => {
		revision();
		return layout.orientation;
	};

	const navigateFile = async (
		id: string,
		selection?: { anchor: number; head: number },
		record = true,
	) => {
		if (record && workspace.active)
			history.record({
				id: workspace.active.id,
				selection: workspace.active.editor.selection,
			});
		const known = workspace.documents.find(
			(document) => document.id === id,
		);
		if (known) workspace.activate(id);
		else workspace.open(await host.readTextFile(id));
		const document = workspace.active;
		if (!document) return;
		if (selection)
			document.editor.setSelection({
				anchor: Math.min(
					selection.anchor,
					document.editor.snapshot.text.length,
				),
				head: Math.min(
					selection.head,
					document.editor.snapshot.text.length,
				),
			});
		if (record)
			history.record({ id, selection: document.editor.selection });
		setRevealRequest((value) => value + 1);
		changed();
		setEditorFocus((value) => value + 1);
	};
	const navigateOffset = (offset: number) => {
		const document = workspace.active;
		if (!document) return;
		history.record({
			id: document.id,
			selection: document.editor.selection,
		});
		document.editor.setSelection({ anchor: offset, head: offset });
		history.record({
			id: document.id,
			selection: document.editor.selection,
		});
		setRevealRequest((value) => value + 1);
		changed();
		setEditorFocus((value) => value + 1);
	};

	const openEntry = (entry: ExplorerEntry) =>
		void perform(() => navigateFile(entry.id));
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
		let polling = false;
		const poll = async () => {
			if (polling || busy() || document.visibilityState === "hidden")
				return;
			polling = true;
			let modified = false;
			try {
				for (const document of workspace.documents) {
					if (!host.canWatch(document.id)) continue;
					try {
						if (
							document.checkExternal(
								(await host.readTextFile(document.id)).text,
							)
						)
							modified = true;
					} catch (error) {
						if (
							error instanceof DOMException &&
							error.name === "NotFoundError" &&
							document.markMissing()
						)
							modified = true;
					}
				}
				if (modified) changed();
				refreshExplorer();
			} finally {
				polling = false;
			}
		};
		const pollingTimer = window.setInterval(() => void poll(), 4000);
		window.addEventListener("focus", poll);
		onCleanup(() => {
			window.clearInterval(pollingTimer);
			window.removeEventListener("focus", poll);
		});
		try {
			const savedLayout = localStorage.getItem("celestie.layout.v1");
			if (savedLayout)
				layout = WorkspaceLayout.restore(
					savedLayout,
					workspace.documents.map((document) => document.id),
				);
			else if (workspace.active) layout.show(workspace.active.id);
			const active = layout.groups.find(
				(group) => group.id === layout.active,
			)?.documentId;
			if (active) workspace.activate(active);
			else if (workspace.active) layout.show(workspace.active.id);
			setRevision((value) => value + 1);
		} catch {
			if (workspace.active) layout.show(workspace.active.id);
			setMessage("Saved layout could not be restored.");
		}
		const unload = (event: BeforeUnloadEvent) => {
			if (workspace.dirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		registerWorkbenchShortcuts(controller);
		window.addEventListener("beforeunload", unload);

		onCleanup(() => {
			window.removeEventListener("beforeunload", unload);
		});
		void perform(async () => {
			const restoredRoots = await host.restoreFolders();
			const restored = restoredRoots.at(-1);
			setFolders(restoredRoots);
			if (!restored) return;
			try {
				const stored = JSON.parse(
					localStorage.getItem(explorerKey) ?? "null",
				);
				setExpandedDirectories(
					new Set<string>(
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

			setSelectedEntry(restored.entry);
			if (!restored.accessible)
				setMessage("Reconnect folder to restore file access.");
		});
	});

	const language = createLanguageService({
		host,
		roots: () =>
			folders()
				.filter((root) => root.accessible)
				.map((root) => root.entry),
		documents,
		revision,
	});
	const controller = {
		language,
		commands,
		openSearch,
		setSearchOpen,
		newFile,
		host,
		open,
		setMessage,
		setFolders,
		setSelectedEntry,
		onExpanded,
		file,
		changed,
		nextUntitledName: () => `untitled-${++untitledCount}.txt`,
		editorControls,
		setSettings,
		settings,
		setNavigationMode,
		setNavigationFocus,
		navigateOffset,
		history,
		navigateFile,
		setRevealRequest,
		run,
		setWorkspaceSearchOpen,
		setWorkspaceSearchFocus,
		navigationMode,
		folder,
		busy,
		activeGroup,
		groups,
		navigationFocus,
		folders,
		documents,
		perform,
		setEditorFocus,
		revision,
		selectionRevision,
		searchOpen,
		replaceOpen,
		searchFocus,
		setSelectionRevision,
		workspaceSearchFocus,
		workspaceSearchOpen,
		openSearchResult,
		applySearchResult,
		sidebarOpen,
		setSidebarOpen,
		manageEntry,
		refreshExplorer,
		selectedEntry,
		openEntry,
		isExpanded,
		explorerRevision,
		documentName,
		documentDirty,
		close,
		splitDirection,
		focusGroup,
		groupDocument,
		persist,
		revealRequest,
		editorFocus,
		message,
		dirty,
		workspace: () => workspace,
		layout: () => layout,
		searchControl: () => searchControl,
		setSearchControl: (control: FindReplaceControl) => {
			searchControl = control;
		},
	};
	registerWorkbenchCommands(controller);
	return controller;
}
export type WorkbenchController = ReturnType<typeof createWorkbenchController>;
