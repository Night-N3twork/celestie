export default function Page(props: { title?: string }) {
	return (
		<div class="page">
			<h1>{props.title ?? "Page"}</h1>
		</div>
	);
}
