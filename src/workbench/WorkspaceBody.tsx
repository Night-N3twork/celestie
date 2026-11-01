import { Show } from "solid-js";
import type { DevelopmentController } from "../development/createDevelopmentController";
import SourceControlPanel from "../development/SourceControlPanel";
import ActivityRail from "./ActivityRail";
import type { createWorkbenchBindings } from "./createWorkbenchBindings";
import type { WorkbenchController } from "./createWorkbenchController";
import EditorGroups from "./EditorGroups";
import EditorTabs from "./EditorTabs";
import ExplorerPanel from "./ExplorerPanel";
export default function WorkspaceBody(props: {
	controller: WorkbenchController;
	development: DevelopmentController;
	bindings: ReturnType<typeof createWorkbenchBindings>;
}) {
	const { controller, development, bindings } = props;
	return (
		<div class="workspace-body">
			<ActivityRail
				{...bindings.activityRail}
				onExplorer={development.showExplorer}
				sourceControlOpen={() =>
					development.sidebarView() === "git" &&
					controller.sidebarOpen()
				}
				onSourceControl={development.showSourceControl}
			/>
			<Show when={controller.sidebarOpen()}>
				<Show
					when={development.sidebarView() === "explorer"}
					fallback={
						<SourceControlPanel
							development={development}
							onOpen={(id) =>
								void controller.perform(() =>
									controller.navigateFile(id),
								)
							}
						/>
					}
				>
					<ExplorerPanel {...bindings.explorerPanel} />
				</Show>
			</Show>
			<div class="workspace-editor editor-area">
				<EditorTabs {...bindings.editorTabs} />
				<EditorGroups {...bindings.editorGroups} />
			</div>
		</div>
	);
}
