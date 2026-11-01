import { type Accessor, Show } from "solid-js";
import type { BrowserFileHost } from "../platform/browser/fileHost";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";

interface Props {
	file: Accessor<WorkspaceDocument | undefined>;
	busy: Accessor<boolean>;
	host: BrowserFileHost;
	changed: () => void;
	perform: (action: () => void | Promise<void>) => Promise<void>;
}
export default function DocumentAlerts(props: Props) {
	const { file, busy, host, changed, perform } = props;
	return (
		<>
			<Show when={file()?.missing}>
				<p role="alert">
					This file was removed from disk. Its buffer is preserved as
					unsaved; use Download copy to recover its contents.
				</p>
			</Show>
			<Show when={file()?.externalText !== undefined}>
				<p role="alert">
					This file changed on disk.{" "}
					<button
						type="button"
						onClick={() => {
							const document = file();
							if (
								document?.externalText !== undefined &&
								window.confirm(
									"Discard local edits and reload the external version?",
								)
							) {
								document.reload(document.externalText);
								changed();
							}
						}}
					>
						Reload external version
					</button>
					<button
						type="button"
						disabled={busy()}
						onClick={() =>
							void perform(async () => {
								if (
									window.confirm(
										"Overwrite the external version with your local edits?",
									)
								) {
									await file()?.save(host, true);
									changed();
								}
							})
						}
					>
						Overwrite external version
					</button>
				</p>
			</Show>
		</>
	);
}
