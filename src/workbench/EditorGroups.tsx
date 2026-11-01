import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";
import type { EditorSession } from "../editor/core/editor";
import Editor, { type EditorControl } from "../editor/view/Editor";
import CloseIcon from "../icons/actions/close.svg";
import FileIcon from "../icons/files/file.svg";
import type { LanguageDocument } from "../language/protocol";
import type { EditorSettings } from "../settings/editorSettings";
import type { EditorGroup, WorkspaceLayout } from "../workspace/layout";
import type { Workspace } from "../workspace/workspace";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";

interface Props {
	language: Accessor<Map<string, LanguageDocument>>;
	splitDirection: Accessor<"row" | "column">;
	groups: Accessor<EditorGroup[]>;
	activeGroup: Accessor<string>;
	layout: Accessor<WorkspaceLayout>;
	focusGroup: (id: string) => void;
	setEditorFocus: Setter<number>;
	groupDocument: (id: string) => WorkspaceDocument | undefined;
	workspace: Accessor<Workspace>;
	changed: () => void;
	editorControls: Map<EditorSession, EditorControl>;
	revision: Accessor<number>;
	settings: Accessor<EditorSettings>;
	busy: Accessor<boolean>;
	setSelectionRevision: Setter<number>;
	persist: () => void;
	revealRequest: Accessor<number>;
	editorFocus: Accessor<number>;
}

export default function EditorGroups(props: Props) {
	const {
		splitDirection,
		groups,
		activeGroup,
		layout,
		focusGroup,
		setEditorFocus,
		groupDocument,
		workspace,
		changed,
		editorControls,
		revision,
		settings,
		busy,
		setSelectionRevision,
		persist,
		revealRequest,
		editorFocus,
	} = props;
	return (
		<div
			style={{
				display: "flex",
				flex: 1,
				"min-height": "0",
				"min-width": "0",
				"flex-direction": splitDirection(),
			}}
		>
			<For each={groups()}>
				{(group) => (
					<section
						class="workspace-editor editor-group"
						classList={{
							"active-group": activeGroup() === group.id,
						}}
						aria-label={`Editor group ${group.id}`}
						onFocusIn={() => {
							if (layout().active !== group.id)
								focusGroup(group.id);
						}}
					>
						<div class="editor-group-header">
							<button
								type="button"
								aria-label="Focus group"
								title="Focus this editor group"
								onClick={() => {
									focusGroup(group.id);
									setEditorFocus((value) => value + 1);
								}}
							>
								<FileIcon size={20} nobox aria-hidden="true" />
								<span>
									{groupDocument(group.id)?.name ?? "Editor"}
								</span>
								<span class="group-hint">Focus group</span>
							</button>
							<button
								type="button"
								aria-label="Close group"
								title="Close editor group"
								onClick={() => {
									layout().close(group.id);
									const document = groupDocument(
										layout().active,
									);
									if (document)
										workspace().activate(document.id);
									changed();
								}}
							>
								<CloseIcon size={20} nobox aria-hidden="true" />
							</button>
						</div>
						<Show
							when={groupDocument(group.id)}
							keyed
							fallback={<p>Open a document in this group.</p>}
						>
							{(document) => (
								<Editor
									language={props.language().get(document.id)}
									onReady={(control) => {
										if (control)
											editorControls.set(
												document.editor,
												control,
											);
										else
											editorControls.delete(
												document.editor,
											);
									}}
									session={document.editor}
									revision={revision()}
									settings={settings()}
									readOnly={busy()}
									onChange={changed}
									onSelectionChange={() => {
										setSelectionRevision(
											(value) => value + 1,
										);
										persist();
									}}
									revealRequest={
										activeGroup() === group.id
											? revealRequest()
											: 0
									}
									focusRequest={
										activeGroup() === group.id
											? editorFocus()
											: 0
									}
								/>
							)}
						</Show>
					</section>
				)}
			</For>
		</div>
	);
}
