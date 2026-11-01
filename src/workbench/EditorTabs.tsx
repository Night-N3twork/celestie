import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import UnsavedIcon from "../icons/debug/breakpoint.svg";
import FileIcon from "../icons/files/file.svg";
import type { Workspace } from "../workspace/workspace";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";

interface Props {
	documents: Accessor<readonly WorkspaceDocument[]>;
	file: Accessor<WorkspaceDocument | undefined>;
	busy: Accessor<boolean>;
	workspace: Accessor<Workspace>;
	changed: () => void;
	documentName: (document: { name: string }) => string;
	documentDirty: (document: { dirty: boolean }) => boolean;
	close: (id: string) => void;
}

export default function EditorTabs(props: Props) {
	const {
		documents,
		file,
		busy,
		workspace,
		changed,
		documentName,
		documentDirty,
		close,
	} = props;
	return (
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
							aria-pressed={file()?.id === document.id}
							onClick={() => {
								workspace().activate(document.id);
								changed();
							}}
						>
							<FileIcon size={20} nobox aria-hidden="true" />
							{documentName(document)}
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
							aria-label={`Close ${documentName(document)}`}
							onClick={() => close(document.id)}
						>
							<CloseIcon size={18} nobox aria-hidden="true" />
						</button>
					</div>
				)}
			</For>
		</fieldset>
	);
}
