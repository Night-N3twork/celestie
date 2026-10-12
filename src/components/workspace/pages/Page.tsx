export default function Page(props: {
	title?: string;
	id?: string;
	labelledBy?: string;
}) {
	return (
		<div
			class="page"
			id={props.id}
			role="tabpanel"
			aria-labelledby={props.labelledBy}
		>
			<h1>{props.title ?? "Page"}</h1>
		</div>
	);
}
