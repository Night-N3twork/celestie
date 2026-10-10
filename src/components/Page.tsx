import { main } from "./Page.css";

export default function Page(props: { title?: string }) {
	return (
		<div class={main}>
			<h1>{props.title ?? "Page"}</h1>
		</div>
	);
}
