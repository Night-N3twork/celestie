import type { Accessor, Setter } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import SplitIcon from "../icons/navigation/split-editor.svg";
import type { EditorSettings } from "../settings/editorSettings";
import type { EditorGroup, WorkspaceLayout } from "../workspace/layout";
import type { Workspace } from "../workspace/workspace";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";
import ActionButton from "./ActionButton";
import CommandMenu, { type MenuAction } from "./CommandMenu";
import EditorSettingsDialog from "./EditorSettingsDialog";

interface Props {
	commands: import("../commands/registry").CommandRegistry;
	busy: Accessor<boolean>;
	file: Accessor<WorkspaceDocument | undefined>;
	run: (id: string) => Promise<unknown>;
	activeGroup: Accessor<string>;
	workspace: Accessor<Workspace>;
	layout: Accessor<WorkspaceLayout>;
	changed: () => void;
	groups: Accessor<EditorGroup[]>;
	settings: Accessor<EditorSettings>;
	setSettings: Setter<EditorSettings>;
}

export default function WorkbenchToolbar(props: Props) {
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const command = (
		label: string,
		id: string,
		shortcut?: string,
		needsFile = false,
	): MenuAction => ({
		label,
		shortcut,
		disabled: props.busy() || (needsFile && !props.file()),
		action: () => void props.run(id),
	});
	onMount(() => {
		const unregister = props.commands.register({
			id: "settings.editor",
			title: "Open editor settings",
			execute: () => {
				setSettingsOpen(true);
			},
		});
		onCleanup(unregister);
		const keydown = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				event.code === "Comma" &&
				!event.isComposing
			) {
				event.preventDefault();
				setSettingsOpen(true);
			}
		};
		window.addEventListener("keydown", keydown);
		onCleanup(() => window.removeEventListener("keydown", keydown));
	});
	return (
		<>
			<nav
				class="editor-toolbar main-menu-bar"
				aria-label="File and edit commands"
			>
				<CommandMenu
					label="File"
					groups={[
						[
							command("New file", "file.new", "Ctrl+N"),
							command("Open file…", "file.open", "Ctrl+O"),
							command(
								"Open folder…",
								"folder.open",
								"Ctrl+Shift+O",
							),
						],
						[
							command("Save", "file.save", "Ctrl+S", true),
							command("Save all", "file.saveAll", "Ctrl+Shift+S"),
							command(
								"Download copy",
								"file.download",
								undefined,
								true,
							),
						],
						[
							{
								label: "Settings…",
								shortcut: "Ctrl+,",
								action: () => setSettingsOpen(true),
							},
						],
					]}
				/>
				<CommandMenu
					label="Edit"
					groups={[
						[
							command("Undo", "edit.undo", "Ctrl+Z", true),
							command("Redo", "edit.redo", "Ctrl+Shift+Z", true),
						],
						[
							command("Find…", "search.find", "Ctrl+F"),
							command("Replace…", "search.replace", "Ctrl+H"),
							command(
								"Find in files…",
								"search.workspace",
								"Ctrl+Shift+F",
							),
						],
						[
							command(
								"Format document",
								"editor.format",
								"Shift+Alt+F",
								true,
							),
						],
					]}
				/>
				<CommandMenu
					label="View"
					groups={[
						[
							command(
								"Command palette…",
								"navigation.commands",
								"Ctrl+Shift+P",
							),
						],
						[
							command(
								"Search",
								"search.workspace",
								"Ctrl+Shift+F",
							),
							command("Source control", "git.show"),
							command(
								"Run and Debug",
								"debug.show",
								"Ctrl+Shift+D",
							),
						],
						[
							command("Terminal", "terminal.toggle", "Ctrl+`"),
							command("Problems", "problems.show"),
						],
						[
							{
								label: "Word wrap",
								checked: props.settings().wordWrap,
								action: () =>
									props.setSettings({
										...props.settings(),
										wordWrap: !props.settings().wordWrap,
									}),
							},
							{
								label: "Line numbers",
								checked: props.settings().lineNumbers,
								action: () =>
									props.setSettings({
										...props.settings(),
										lineNumbers:
											!props.settings().lineNumbers,
									}),
							},
						],
					]}
				/>
				<CommandMenu
					label="Go"
					groups={[
						[
							command("Back", "navigation.back", "Alt+Left"),
							command(
								"Forward",
								"navigation.forward",
								"Alt+Right",
							),
						],
						[
							command(
								"Go to file…",
								"navigation.files",
								"Ctrl+P",
							),
							command("Go to line…", "navigation.line", "Ctrl+G"),
							command("Go to symbol…", "navigation.symbols"),
						],
						[
							command(
								"Go to matching bracket",
								"editor.bracket",
								undefined,
								true,
							),
						],
					]}
				/>
				<CommandMenu
					label="Run"
					groups={[
						[
							command("Run project script", "task.run"),
							command(
								"Run and Debug",
								"debug.show",
								"Ctrl+Shift+D",
							),
						],
						[command("Open terminal", "terminal.toggle", "Ctrl+`")],
					]}
				/>
				<CommandMenu
					label="Window"
					groups={[
						[
							command("Split editor", "layout.split"),
							command(
								"Change split orientation",
								"layout.orientation",
							),
						],
						[
							command(
								"Move tab left",
								"layout.tabLeft",
								undefined,
								true,
							),
							command(
								"Move tab right",
								"layout.tabRight",
								undefined,
								true,
							),
						],
						props
							.groups()
							.filter((group) => group.id !== props.activeGroup())
							.map((group) => ({
								label: `Move tab to group ${props.groups().indexOf(group) + 1}`,
								disabled: !props.file(),
								action: () => {
									const doc = props.workspace().active;
									if (doc) {
										props.layout().move(doc.id, group.id);
										props.changed();
									}
								},
							})),
					].filter((group) => group.length)}
				/>
				<div class="toolbar-spacer" />
				<ActionButton
					label="Split editor"
					icon={SplitIcon}
					compact
					disabled={props.busy()}
					onClick={() => void props.run("layout.split")}
				/>
			</nav>
			<Show when={settingsOpen()}>
				<EditorSettingsDialog
					settings={props.settings}
					setSettings={props.setSettings}
					onClose={() => setSettingsOpen(false)}
				/>
			</Show>
		</>
	);
}
