import { createSignal, Match, Show, Switch } from "solid-js";
import type { DevelopmentController } from "../development/createDevelopmentController";
import RunDebugPanel from "../development/RunDebugPanel";
import SourceControlPanel from "../development/SourceControlPanel";
import ActivityRail from "./ActivityRail";
import type { createWorkbenchBindings } from "./createWorkbenchBindings";
import type { WorkbenchController } from "./createWorkbenchController";
import DiffViewer from "./DiffViewer";
import DockResizeHandle from "./DockResizeHandle";
import EditorGroups from "./EditorGroups";
import EditorTabs from "./EditorTabs";
import ExplorerPanel from "./ExplorerPanel";
import WorkspaceSearch from "./WorkspaceSearch";
export default function WorkspaceBody(props: {
	controller: WorkbenchController;
	development: DevelopmentController;
	bindings: ReturnType<typeof createWorkbenchBindings>;
}) {
	const { controller, development, bindings } = props;
	const [width, setWidth] = createSignal(280);
	return (
		<div class="workspace-body" style={{ "--dock-width": `${width()}px` }}>
			<ActivityRail
				{...bindings.activityRail}
				onExplorer={development.showExplorer}
				sourceControlOpen={() =>
					development.sidebarView() === "git" &&
					controller.sidebarOpen() &&
					!controller.workspaceSearchOpen()
				}
				onSourceControl={development.showSourceControl}
				runAndDebugOpen={() =>
					development.sidebarView() === "run" &&
					controller.sidebarOpen() &&
					!controller.workspaceSearchOpen()
				}
				onRunAndDebug={development.showRunAndDebug}
			/>
			<WorkspaceSearch controller={controller} />
			<Show
				when={
					controller.sidebarOpen() &&
					!controller.workspaceSearchOpen()
				}
			>
				<Switch>
					<Match when={development.sidebarView() === "git"}>
						<SourceControlPanel
							onReview={(review) => controller.diffs.open(review)}
							development={development}
							onHide={() => controller.setSidebarOpen(false)}
							onOpenFolder={() =>
								void controller.run("folder.open")
							}
						/>
					</Match>
					<Match when={development.sidebarView() === "run"}>
						<RunDebugPanel
							controller={controller}
							development={development}
						/>
					</Match>
					<Match when={development.sidebarView() === "explorer"}>
						<ExplorerPanel
							{...bindings.explorerPanel}
							onHide={() => controller.setSidebarOpen(false)}
						/>
					</Match>
				</Switch>
			</Show>
			<Show when={controller.sidebarOpen()}>
				<DockResizeHandle
					axis="horizontal"
					label="Resize sidebar"
					value={width()}
					min={180}
					max={() => window.innerWidth * 0.5}
					onResize={setWidth}
				/>
			</Show>
			<div class="workspace-editor editor-area">
				<EditorTabs {...bindings.editorTabs} />
				<Show
					when={controller.diffs.active()}
					keyed
					fallback={<EditorGroups {...bindings.editorGroups} />}
				>
					{(review) => (
						<DiffViewer
							review={review}
							onOpen={() =>
								void controller.perform(() =>
									controller.navigateFile(review.fileId),
								)
							}
						/>
					)}
				</Show>
			</div>
		</div>
	);
}
