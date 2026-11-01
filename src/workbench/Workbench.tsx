import { createDevelopmentController } from "../development/createDevelopmentController";
import DevelopmentPanel from "../development/DevelopmentPanel";
import { createWorkbenchBindings } from "./createWorkbenchBindings";
import { createWorkbenchController } from "./createWorkbenchController";
import DocumentAlerts from "./DocumentAlerts";
import LanguageTools from "./LanguageTools";
import Navigator from "./Navigator";
import ToolWindowBar from "./ToolWindowBar";
import WorkbenchHeader from "./WorkbenchHeader";
import WorkbenchStatus from "./WorkbenchStatus";
import WorkbenchToolbar from "./WorkbenchToolbar";
import WorkspaceBody from "./WorkspaceBody";
export default function Workbench() {
	const controller = createWorkbenchController();
	const bindings = createWorkbenchBindings(controller);
	const development = createDevelopmentController(controller);
	return (
		<section {...bindings.section}>
			<WorkbenchHeader {...bindings.workbenchHeader} />
			<WorkbenchToolbar {...bindings.workbenchToolbar} />
			<Navigator {...bindings.navigator} />
			<LanguageTools controller={controller} />
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
			<ToolWindowBar
				development={development}
				problems={controller.language.problems().length}
			/>
			<WorkbenchStatus {...bindings.workbenchStatus} />
		</section>
	);
}
