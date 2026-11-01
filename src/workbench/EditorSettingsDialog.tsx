import { type Accessor, For, onMount, type Setter } from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import {
	defaultEditorSettings,
	type EditorSettings,
} from "../settings/editorSettings";
import ActionButton from "./ActionButton";
export default function EditorSettingsDialog(props: {
	settings: Accessor<EditorSettings>;
	setSettings: Setter<EditorSettings>;
	onClose: () => void;
}) {
	let dialog!: HTMLDialogElement;
	onMount(() => dialog.showModal());
	return (
		<dialog
			ref={dialog}
			class="editor-settings-dialog"
			aria-labelledby="editor-settings-title"
			onClose={props.onClose}
		>
			<header>
				<h2 id="editor-settings-title">Settings</h2>
				<ActionButton
					icon={CloseIcon}
					label="Close settings"
					compact
					onClick={() => dialog.close()}
				/>
			</header>
			<div class="settings-layout">
				<nav aria-label="Settings categories">
					<span aria-current="page">Editor</span>
				</nav>
				<section>
					<h3>Editor</h3>
					<p class="settings-description">
						Changes apply immediately to all open editors.
					</p>
					<div class="setting-row">
						<label for="setting-font">
							Font size
							<small>Size of the editor text in pixels.</small>
						</label>
						<input
							id="setting-font"
							type="number"
							min="10"
							max="32"
							value={props.settings().fontSize}
							onInput={(event) => {
								const n = event.currentTarget.valueAsNumber;
								if (Number.isInteger(n) && n >= 10 && n <= 32)
									props.setSettings({
										...props.settings(),
										fontSize: n,
									});
							}}
						/>
					</div>
					<div class="setting-row">
						<label for="setting-tab">
							Tab size
							<small>
								Number of columns per indentation level.
							</small>
						</label>
						<select
							id="setting-tab"
							value={props.settings().tabSize}
							onChange={(e) =>
								props.setSettings({
									...props.settings(),
									tabSize: Number(e.currentTarget.value),
								})
							}
						>
							<option value="2">2</option>
							<option value="4">4</option>
							<option value="8">8</option>
						</select>
					</div>
					<For
						each={[
							{
								key: "insertSpaces" as const,
								label: "Insert spaces",
								description: "Use spaces when pressing Tab.",
							},
							{
								key: "lineNumbers" as const,
								label: "Line numbers",
								description:
									"Show line numbers beside the editor.",
							},
							{
								key: "wordWrap" as const,
								label: "Word wrap",
								description:
									"Wrap long lines to the editor width.",
							},
						]}
					>
						{(item) => (
							<div class="setting-row">
								<label for={`setting-${item.key}`}>
									{item.label}
									<small>{item.description}</small>
								</label>
								<input
									id={`setting-${item.key}`}
									type="checkbox"
									checked={props.settings()[item.key]}
									onChange={(e) =>
										props.setSettings({
											...props.settings(),
											[item.key]: e.currentTarget.checked,
										})
									}
								/>
							</div>
						)}
					</For>
				</section>
			</div>
			<footer>
				<button
					type="button"
					onClick={() =>
						props.setSettings({ ...defaultEditorSettings })
					}
				>
					Reset defaults
				</button>
				<button
					type="button"
					class="primary"
					onClick={() => dialog.close()}
				>
					Done
				</button>
			</footer>
		</dialog>
	);
}
