import { createSignal, onCleanup, onMount } from "solid-js";
import { CommandRegistry } from "../commands/registry";
import Editor from "../editor/view/Editor";
import { BrowserFileHost } from "../platform/browser/fileHost";
import { defaultEditorSettings } from "../settings/editorSettings";
import { WorkspaceDocument } from "../workspace/workspaceDocument";

const draftKey = "celestie.draft.v1";

export default function Workbench() {
	const host = new BrowserFileHost();
	const commands = new CommandRegistry();
	const initial = new WorkspaceDocument({
		id: crypto.randomUUID(),
		name: "untitled.txt",
		text: "",
	});
	const [file, setFile] = createSignal(initial);
	const [revision, setRevision] = createSignal(0);
	const [settings, setSettings] = createSignal(defaultEditorSettings);
	const [message, setMessage] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	host.remember(initial);
	const changed = () => {
		setRevision((value) => value + 1);
		try {
			localStorage.setItem(
				draftKey,
				JSON.stringify({
					name: file().name,
					text: file().editor.snapshot.text,
					dirty: file().dirty,
				}),
			);
		} catch {
			setMessage(
				"Browser storage error.",
			);
		}
	};
	const replace = (next: WorkspaceDocument) => {
		host.remember(next);
		setFile(next);
		changed();
	};
	const canReplace = () =>
		!file().dirty ||
		window.confirm("Discard unsaved changes in this file?");
	commands.register({
		id: "file.new",
		title: "New",
		execute: () => {
			if (canReplace())
				replace(
					new WorkspaceDocument({
						id: crypto.randomUUID(),
						name: "untitled.txt",
						text: "",
					}),
				);
		},
	});
	commands.register({
		id: "file.open",
		title: "Open",
		execute: async () => {
			if (!canReplace()) return;
			const opened = await host.openTextFile();
			if (opened) {
				replace(new WorkspaceDocument(opened));
				setMessage(`Opened ${opened.name}`);
			}
		},
	});
	commands.register({
		id: "file.save",
		title: "Save",
		execute: async () => {
			await file().save(host);
			setMessage("Saved");
			changed();
		},
	});
	commands.register({
		id: "file.download",
		title: "Download copy",
		execute: () => {
			host.download({
				id: file().id,
				name: file().name,
				text: file().editor.snapshot.text,
			});
			setMessage("Download requested.");
		},
	});
	for (const action of ["undo", "redo"] as const)
		commands.register({
			id: `edit.${action}`,
			title: action,
			execute: () => {
				file().editor[action]();
				changed();
			},
		});
	const run = async (id: string) => {
		if (busy()) return;
		setBusy(true);
		try {
			await commands.execute(id);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	onMount(() => {
		try {
			const raw = localStorage.getItem(draftKey);
			if (raw) {
				const draft: unknown = JSON.parse(raw);
				if (
					typeof draft === "object" &&
					draft !== null &&
					"name" in draft &&
					"text" in draft &&
					"dirty" in draft &&
					typeof draft.name === "string" &&
					typeof draft.text === "string" &&
					draft.dirty === true
				) {
					const recovered = new WorkspaceDocument({
						id: crypto.randomUUID(),
						name: draft.name,
						text: draft.text,
					});
					recovered.markUnsaved();
					replace(recovered);
					setMessage(
						"Recovered unsaved draft. Save to choose its destination.",
					);
				}
			}
		} catch {
			setMessage("Draft could not be recovered.");
		}
		const unload = (event: BeforeUnloadEvent) => {
			if (file().dirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		const keydown = (event: KeyboardEvent) => {
			if (
				event.isComposing ||
				!(event.ctrlKey || event.metaKey) ||
				event.altKey
			)
				return;
			const key = event.key.toLowerCase();
			const id =
				key === "s"
					? "file.save"
					: key === "o"
						? "file.open"
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
	});
	const dirty = () => {
		revision();
		return file().dirty;
	};
	return (
		<section class="workbench" aria-label="Editor workbench">
			<nav class="editor-toolbar" aria-label="File and edit commands">
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
			<div class="editor-tab">
				{file().name}
				{dirty() ? " •" : ""}
			</div>
			<Editor
				session={file().editor}
				revision={revision()}
				settings={settings()}
				readOnly={busy()}
				onChange={changed}
			/>
			<footer class="editor-status" role="status">
				{message() ? `${message()} - ` : ""}
				{dirty() ? "Unsaved changes" : "No unsaved changes"}
			</footer>
		</section>
	);
}
