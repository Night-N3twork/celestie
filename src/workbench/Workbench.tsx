import { Show } from "solid-js";
import ActivityRail from "./ActivityRail";
import { createWorkbenchBindings } from "./createWorkbenchBindings";
import { createWorkbenchController } from "./createWorkbenchController";
import DocumentAlerts from "./DocumentAlerts";
import EditorGroups from "./EditorGroups";
import EditorTabs from "./EditorTabs";
import ExplorerPanel from "./ExplorerPanel";
import FindReplace from "./FindReplace";
import Navigator from "./Navigator";
import WorkbenchHeader from "./WorkbenchHeader";
import WorkbenchStatus from "./WorkbenchStatus";
import WorkbenchToolbar from "./WorkbenchToolbar";
import WorkspaceSearch from "./WorkspaceSearch";
export default function Workbench() {
	const controller = createWorkbenchController();
	const bindings = createWorkbenchBindings(controller);
	return (
		<section {...bindings.section}>
			<WorkbenchHeader {...bindings.workbenchHeader} />
			<WorkbenchToolbar {...bindings.workbenchToolbar} />
			<Navigator {...bindings.navigator} />
			<FindReplace {...bindings.findReplace} />
			<WorkspaceSearch {...bindings.workspaceSearch} />
			<DocumentAlerts {...bindings.documentAlerts} />
			<div class="workspace-body">
				<ActivityRail {...bindings.activityRail} />
				<Show when={controller.sidebarOpen()}>
					<ExplorerPanel {...bindings.explorerPanel} />
				</Show>
				<div class="workspace-editor editor-area">
					<EditorTabs {...bindings.editorTabs} />
					<EditorGroups {...bindings.editorGroups} />
				</div>
			</div>
			<WorkbenchStatus {...bindings.workbenchStatus} />
		</section>
	);
}
