import Bar from "@components/bars/Bars";
import { newTabs } from "@components/workspace/tabs/model";
import Workspace from "@components/workspace/Workspace";
import { Link, Title } from "@solidjs/meta";
import { onCleanup, onMount } from "solid-js";
import { disposeRuntime, getRuntime } from "./runtime";

export default function Editor() {
	const tabs = newTabs();
	onMount(() => {
		getRuntime().catch((error: unknown) => {
			console.error("Failed to start the Dusk runtime", error);
		});
	});
	onCleanup(() => void disposeRuntime());
	return (
		<>
			<Title>Celestie</Title>
			<Link
				rel="icon"
				type="image/svg+xml"
				href="/icons/celestie.fav.svg"
			/>
			<div class="editor-row">
				<Bar id="t" onNew={tabs.add} />
			</div>
			<div class="editor-row editor-main">
				<Bar vertical id="l" />
				<Workspace tabs={tabs} />
				<Bar vertical id="r" />
			</div>
			<div class="editor-row">
				<Bar id="b" />
			</div>
		</>
	);
}
