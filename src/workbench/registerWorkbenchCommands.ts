import { lexicalBrackets, lineAction } from "../editor/core/actions";
import { formatDocument } from "../editor/format";
import { LineIndex } from "../editor/view/lineIndex";
import type { WorkbenchController } from "./createWorkbenchController";

type Services = Pick<
	WorkbenchController,
	| "commands"
	| "openSearch"
	| "searchControl"
	| "revealSearch"
	| "openWorkspaceSearch"
	| "newFile"
	| "host"
	| "open"
	| "setMessage"
	| "setFolders"
	| "setSelectedEntry"
	| "onExpanded"
	| "file"
	| "changed"
	| "layout"
	| "workspace"
	| "nextUntitledName"
	| "editorControls"
	| "setSettings"
	| "settings"
	| "setNavigationMode"
	| "setNavigationFocus"
	| "navigateOffset"
	| "history"
	| "navigateFile"
	| "setRevealRequest"
>;
export function registerWorkbenchCommands(services: Services): void {
	const {
		commands,
		openSearch,
		searchControl,
		revealSearch,
		openWorkspaceSearch,
		newFile,
		host,
		open,
		setMessage,
		setFolders,
		setSelectedEntry,
		onExpanded,
		file,
		changed,
		layout,
		workspace,
		nextUntitledName,
		editorControls,
		setSettings,
		settings,
		setNavigationMode,
		setNavigationFocus,
		navigateOffset,
		history,
		navigateFile,
		setRevealRequest,
	} = services;
	commands.register({
		id: "search.find",
		title: "Search current file",
		execute: () => openSearch(false),
	});
	commands.register({
		id: "search.replace",
		title: "Replace in current file",
		execute: () => openSearch(true),
	});
	commands.register({
		id: "search.workspace",
		title: "Search workspace",
		execute: () => openWorkspaceSearch(false),
	});
	commands.register({
		id: "search.workspaceReplace",
		title: "Replace in workspace",
		execute: () => openWorkspaceSearch(true),
	});
	for (const backwards of [false, true])
		commands.register({
			id: backwards ? "search.previous" : "search.next",
			title: backwards ? "Previous match" : "Next match",
			execute: () => {
				if (!searchControl()?.hasQuery()) {
					openSearch(false);
					return;
				}
				revealSearch();
				searchControl()?.next(backwards);
			},
		});
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
				setFolders((previous) => [
					...previous.filter((root) => root.entry.id !== opened.id),
					{ entry: opened, accessible: true },
				]);
				setSelectedEntry(opened);

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
		execute: async () => {
			const document = file();
			if (!document) return;
			await host.download({
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
	commands.register({
		id: "layout.split",
		title: "Split editor",
		execute: () => {
			if (layout().groups.length >= 4)
				throw new Error("Up to four editor groups are supported.");
			const active = workspace().active;
			if (active) layout().show(active.id);
			let document = workspace().documents.find(
				(document) =>
					!layout().groups.some(
						(group) => group.documentId === document.id,
					),
			);
			if (!document) {
				document = workspace().open({
					id: crypto.randomUUID(),
					name: nextUntitledName(),
					text: "",
				});
				host.remember(document);
			}
			layout().split(document.id);
			workspace().activate(document.id);
			changed();
		},
	});
	commands.register({
		id: "layout.orientation",
		title: "Change split orientation",
		execute: () => {
			layout().orientation =
				layout().orientation === "row" ? "column" : "row";
			changed();
		},
	});
	for (const direction of [-1, 1] as const)
		commands.register({
			id: direction < 0 ? "layout.tabLeft" : "layout.tabRight",
			title: direction < 0 ? "Move tab left" : "Move tab right",
			execute: () => {
				const active = workspace().active;
				if (active) workspace().reorder(active.id, direction);
				changed();
			},
		});
	commands.register({
		id: "editor.nextOccurrence",
		title: "Add cursor at next occurrence",
		execute: () => {
			const document = file();
			if (document) editorControls.get(document.editor)?.selectNext();
		},
	});
	commands.register({
		id: "editor.allOccurrences",
		title: "Select all occurrences",
		execute: () => {
			const document = file();
			if (document) editorControls.get(document.editor)?.selectAll();
		},
	});
	commands.register({
		id: "editor.wrap",
		title: "Toggle word wrapping",
		execute: () => {
			setSettings({ ...settings(), wordWrap: !settings().wordWrap });
		},
	});
	for (const action of ["fold", "unfold"] as const)
		commands.register({
			id: `editor.${action}`,
			title:
				action === "fold"
					? "Fold selected or enclosing block"
					: "Unfold all blocks",
			execute: () => {
				const document = file();
				if (document) editorControls.get(document.editor)?.[action]();
			},
		});
	for (const mode of ["commands", "files", "symbols"] as const)
		commands.register({
			id: `navigation.${mode}`,
			title:
				mode === "commands"
					? "Command palette"
					: mode === "files"
						? "Quick open"
						: "Go to symbol",
			execute: () => {
				setNavigationMode(mode);
				setNavigationFocus((value) => value + 1);
			},
		});
	commands.register({
		id: "navigation.line",
		title: "Go to line",
		execute: () => {
			const document = workspace().active;
			if (!document) return;
			const requested = window.prompt("Line[:column] (starting at 1)");
			if (!requested) return;
			const match = /^(\d+)(?::(\d+))?$/.exec(requested.trim());
			if (!match)
				throw new Error(
					"Enter a line number, optionally followed by :column.",
				);
			const lines = new LineIndex(document.editor.snapshot.text);
			const line = Number(match[1]) - 1;
			if (line < 0 || line >= lines.count)
				throw new Error("Line number is outside this document.");
			navigateOffset(
				Math.min(
					lines.ends[line],
					lines.starts[line] + Math.max(0, Number(match[2] ?? 1) - 1),
				),
			);
		},
	});
	for (const direction of [-1, 1] as const)
		commands.register({
			id: direction < 0 ? "navigation.back" : "navigation.forward",
			title: direction < 0 ? "Go back" : "Go forward",
			execute: async () => {
				const current = workspace().active;
				const location = history.move(
					direction,
					current
						? {
								id: current.id,
								selection: current.editor.selection,
							}
						: undefined,
				);
				if (location)
					await navigateFile(location.id, location.selection, false);
			},
		});
	for (const action of [
		"duplicate",
		"delete",
		"up",
		"down",
		"comment",
	] as const)
		commands.register({
			id: `editor.${action}`,
			title: `${action} lines`,
			execute: () => {
				const document = workspace().active;
				if (!document) return;
				const transaction = lineAction(
					document.editor.snapshot.text,
					document.editor.selection,
					action,
					document.name,
				);
				if (transaction) {
					document.editor.apply(transaction);
					changed();
					setRevealRequest((value) => value + 1);
				}
			},
		});
	commands.register({
		id: "editor.bracket",
		title: "Go to matching bracket",
		execute: () => {
			const document = workspace().active;
			if (!document) return;
			const pairs = lexicalBrackets(document.editor.snapshot.text);
			const head = document.editor.selection.head;
			const target = pairs.get(head) ?? pairs.get(head - 1);
			if (target !== undefined) navigateOffset(target);
		},
	});
	commands.register({
		id: "editor.format",
		title: "Format document",
		execute: async () => {
			const document = workspace().active;
			if (!document) return;
			const before = document.editor.snapshot;
			const formatted = await formatDocument(
				before.text,
				document.name,
				settings(),
			);
			if (document.editor.snapshot.version !== before.version)
				throw new Error(
					"Document changed while formatting. Try again.",
				);
			if (formatted !== before.text) {
				document.editor.apply({
					edit: { from: 0, to: before.text.length, text: formatted },
					selectionAfter: {
						anchor: Math.min(
							document.editor.selection.anchor,
							formatted.length,
						),
						head: Math.min(
							document.editor.selection.head,
							formatted.length,
						),
					},
				});
				changed();
			}
		},
	});
	commands.register({
		id: "file.saveAll",
		title: "Save all files",
		execute: async () => {
			for (const document of workspace().documents)
				if (document.dirty) await document.save(host);
			changed();
		},
	});
}
