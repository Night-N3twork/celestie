import Bar from "@components/nav/Bars";
import Page from "@components/Page";
import { Link, Title } from "@solidjs/meta";
import { main, row } from "./style.css";

export default function Editor() {
	return (
		<>
			<Title>Celestie</Title>
			<Link
				rel="icon"
				type="image/svg+xml"
				href="/icons/celestie.fav.svg"
			/>
			<div class={row}>
				<Bar id="t" />
			</div>
			<div class={[row, main].join(" ")}>
				<Bar vertical id="l" />
				<Page />
				<Bar vertical id="r" />
			</div>
			<div class={row}>
				<Bar id="b" />
			</div>
		</>
	);
}
