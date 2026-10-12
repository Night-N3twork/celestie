import Page from "@components/workspace/pages/Page";
import Welcome from "@components/workspace/pages/Welcome";
import { createUniqueId, Show } from "solid-js";
import type { TabsController } from "./tabs/model";
import Tabs from "./tabs/Tabs";

export default function Workspace(props: { tabs: TabsController }) {
	const prefix = createUniqueId();

	return (
		<div class="workspace">
			<Tabs tabs={props.tabs} prefix={prefix} />
			<Show when={props.tabs.active()}>
				{(active) => (
					<Page
						title={active().title}
						id={`${prefix}-panel-${active().id}`}
						labelledBy={`${prefix}-tab-${active().id}`}
					/>
				)}
			</Show>
			<Show when={!props.tabs.active()}>
				<Welcome />
			</Show>
		</div>
	);
}
