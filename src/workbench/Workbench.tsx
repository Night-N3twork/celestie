import { createDevelopmentController } from "../development/createDevelopmentController";
import DevelopmentPanel from "../development/DevelopmentPanel";
import RunControls from "../development/RunControls";
import { createWorkbenchBindings } from "./createWorkbenchBindings";
import { createWorkbenchController } from "./createWorkbenchController";
import DocumentAlerts from "./DocumentAlerts";
import FindReplace from "./FindReplace";
import Navigator from "./Navigator";
import WorkbenchHeader from "./WorkbenchHeader";
import WorkbenchStatus from "./WorkbenchStatus";
import WorkbenchToolbar from "./WorkbenchToolbar";
import WorkspaceBody from "./WorkspaceBody";
import WorkspaceSearch from "./WorkspaceSearch";
export default function Workbench() {
	const controller = createWorkbenchController();
	const bindings = createWorkbenchBindings(controller);
	const development = createDevelopmentController(controller);
	return (
		<section {...bindings.section}>
			<WorkbenchHeader {...bindings.workbenchHeader} />
			<WorkbenchToolbar {...bindings.workbenchToolbar}>
				<RunControls development={development} />
			</WorkbenchToolbar>
			<Navigator {...bindings.navigator} />
			<FindReplace {...bindings.findReplace} />
			<WorkspaceSearch {...bindings.workspaceSearch} />
			<DocumentAlerts {...bindings.documentAlerts} />
			<WorkspaceBody
				controller={controller}
				development={development}
				bindings={bindings}
			/>
			<DevelopmentPanel
				controller={controller}
				development={development}
			/>
			<WorkbenchStatus {...bindings.workbenchStatus} />
		</section>
	);
}
