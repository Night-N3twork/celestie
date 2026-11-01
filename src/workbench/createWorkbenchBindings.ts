import type { ComponentProps, JSX } from "solid-js";
import type ActivityRail from "./ActivityRail";
import type { WorkbenchController } from "./createWorkbenchController";
import type DocumentAlerts from "./DocumentAlerts";
import type EditorGroups from "./EditorGroups";
import type EditorTabs from "./EditorTabs";
import type ExplorerPanel from "./ExplorerPanel";

import type Navigator from "./Navigator";
import type WorkbenchHeader from "./WorkbenchHeader";
import type WorkbenchStatus from "./WorkbenchStatus";
import type WorkbenchToolbar from "./WorkbenchToolbar";

export function createWorkbenchBindings(controller: WorkbenchController) {
	return {
		section: {
			class: "workbench",
			"aria-label": "Editor workbench",
			onPointerDown: (
				event: PointerEvent & { currentTarget: HTMLElement },
			) => {
				const target = event.target as Element;
				for (const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>(
					"details.view-menu[open],details.entry-menu[open]",
				))
					if (!menu.contains(target)) menu.open = false;
				if (
					controller.navigationMode() &&
					!target.closest(".navigation-palette")
				)
					controller.setNavigationMode(undefined);
			},
		} satisfies JSX.HTMLAttributes<HTMLElement>,
		workbenchHeader: {
			folder: controller.folder,
			run: controller.run,
		} satisfies ComponentProps<typeof WorkbenchHeader>,
		workbenchToolbar: {
			commands: controller.commands,
			busy: controller.busy,
			file: controller.file,
			run: controller.run,
			activeGroup: controller.activeGroup,
			workspace: controller.workspace,
			layout: controller.layout,
			changed: controller.changed,
			groups: controller.groups,
			settings: controller.settings,
			setSettings: controller.setSettings,
		} satisfies ComponentProps<typeof WorkbenchToolbar>,
		navigator: {
			get mode() {
				return controller.navigationMode();
			},
			get focusRequest() {
				return controller.navigationFocus();
			},
			host: controller.host,
			get roots() {
				return controller
					.folders()
					.filter((root) => root.accessible)
					.map((root) => root.entry);
			},
			commands: controller.commands,
			text: () => controller.file()?.editor.snapshot.text ?? "",
			documents: controller.documents,
			onFile: (id: string) =>
				controller.perform(() => controller.navigateFile(id)),
			onLocation: controller.navigateOffset,
			onCommand: controller.run,
			onClose: () => {
				controller.setNavigationMode(undefined);
				controller.setEditorFocus((value) => value + 1);
			},
		} satisfies ComponentProps<typeof Navigator>,
		documentAlerts: {
			file: controller.file,
			busy: controller.busy,
			host: controller.host,
			changed: controller.changed,
			perform: controller.perform,
		} satisfies ComponentProps<typeof DocumentAlerts>,
		activityRail: {
			sidebarOpen: controller.sidebarOpen,
			setSidebarOpen: controller.setSidebarOpen,
			workspaceSearchOpen: controller.workspaceSearchOpen,
			setWorkspaceSearchOpen: controller.setWorkspaceSearchOpen,
			openWorkspaceSearch: controller.openWorkspaceSearch,
		} satisfies Pick<
			ComponentProps<typeof ActivityRail>,
			| "sidebarOpen"
			| "setSidebarOpen"
			| "workspaceSearchOpen"
			| "setWorkspaceSearchOpen"
			| "openWorkspaceSearch"
		>,
		explorerPanel: {
			onHide: () => controller.setSidebarOpen(false),
			busy: controller.busy,
			folders: controller.folders,
			manageEntry: controller.manageEntry,
			refreshExplorer: controller.refreshExplorer,
			selectedEntry: controller.selectedEntry,
			run: controller.run,
			perform: controller.perform,
			host: controller.host,
			setFolders: controller.setFolders,
			setSelectedEntry: controller.setSelectedEntry,
			openEntry: controller.openEntry,
			isExpanded: controller.isExpanded,
			onExpanded: controller.onExpanded,
			explorerRevision: controller.explorerRevision,
		} satisfies ComponentProps<typeof ExplorerPanel>,
		editorTabs: {
			diffs: controller.diffs,
			documents: controller.documents,
			file: controller.file,
			busy: controller.busy,
			workspace: controller.workspace,
			changed: controller.changed,
			documentName: controller.documentName,
			documentDirty: controller.documentDirty,
			close: controller.close,
		} satisfies ComponentProps<typeof EditorTabs>,
		editorGroups: {
			language: controller.language.results,
			splitDirection: controller.splitDirection,
			groups: controller.groups,
			activeGroup: controller.activeGroup,
			layout: controller.layout,
			focusGroup: controller.focusGroup,
			setEditorFocus: controller.setEditorFocus,
			groupDocument: controller.groupDocument,
			workspace: controller.workspace,
			changed: controller.changed,
			editorControls: controller.editorControls,
			revision: controller.revision,
			settings: controller.settings,
			busy: controller.busy,
			setSelectionRevision: controller.setSelectionRevision,
			persist: controller.persist,
			revealRequest: controller.revealRequest,
			editorFocus: controller.editorFocus,
		} satisfies ComponentProps<typeof EditorGroups>,
		workbenchStatus: {
			message: controller.message,
			dirty: controller.dirty,
		} satisfies ComponentProps<typeof WorkbenchStatus>,
	};
}
