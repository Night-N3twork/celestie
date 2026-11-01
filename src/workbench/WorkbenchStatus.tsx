import type { Accessor } from "solid-js";

interface Props {
	message: Accessor<string>;
	dirty: Accessor<boolean>;
}

export default function WorkbenchStatus(props: Props) {
	const { message, dirty } = props;
	return (
		<footer class="editor-status" role="status">
			<span class="status-indicator" aria-hidden="true" />
			{message() ? `${message()} - ` : ""}
			{dirty() ? "Unsaved changes" : "No unsaved changes"}
		</footer>
	);
}
