import type { Disposable } from "../api/types";
import type { EditorView } from "../view/editor-view";
import { registerDiffShortcuts } from "./default-shortcuts";
export interface DiffActionHost {
	ready(): boolean;
	canRevert(): boolean;
	next(direction: number): void;
	revert(): void;
	toggleMode(): void;
	toggleUnchanged(): void;
}
export function registerDiffActions(
	view: EditorView,
	host: DiffActionHost,
): Disposable {
	const subscriptions: Disposable[] = [];
	for (const [id, label, run, when, shortcut] of [
		[
			"diff.next",
			"Next Change",
			() => host.next(1),
			() => host.ready(),
			"Alt+F5",
		],
		[
			"diff.previous",
			"Previous Change",
			() => host.next(-1),
			() => host.ready(),
			"Shift+Alt+F5",
		],
		[
			"diff.revert",
			"Revert Current Change",
			() => host.revert(),
			() => host.canRevert(),
			"",
		],
		[
			"diff.toggleMode",
			"Toggle Inline Diff",
			() => host.toggleMode(),
			() => !view.isComposing,
			"",
		],
		[
			"diff.toggleUnchanged",
			"Toggle Unchanged Regions",
			() => host.toggleUnchanged(),
			() => !view.isComposing,
			"",
		],
	] as const)
		subscriptions.push(
			view.commands.register({
				id,
				label,
				run,
				when: () => !view.isComposing && when(),
				shortcut,
				menu: true,
			}),
		);
	subscriptions.push(
		registerDiffShortcuts(view.shortcuts, (id) => {
			void view.executeCommand(id);
		}),
	);
	return {
		dispose() {
			for (const subscription of subscriptions) subscription.dispose();
		},
	};
}
