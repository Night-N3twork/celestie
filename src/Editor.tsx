import Bar from "@components/nav/Bars";
import { newTabs } from "@components/tabs/model";
import Tabs from "@components/tabs/Tabs";
import { Link, Title } from "@solidjs/meta";
import { main, row } from "./style.css";

export default function Editor() {
	const tabs = newTabs();
	return (
		<>
			<Title>Celestie</Title>
			<Link
				rel="icon"
				type="image/svg+xml"
				href="/icons/celestie.fav.svg"
			/>
			<div class={row}>
				<Bar id="t" onNew={tabs.add} />
			</div>
			<div class={[row, main].join(" ")}>
				<Bar vertical id="l" />
				<Tabs tabs={tabs} />
				<Bar vertical id="r" />
			</div>
			<div class={row}>
				<Bar id="b" />
			</div>
		</>
	);
}
