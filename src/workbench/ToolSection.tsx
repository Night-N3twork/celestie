import type { JSX } from "solid-js";
import ChevronIcon from "../icons/navigation/chevron.svg";

export default function ToolSection(props: {
	title: string;
	children: JSX.Element;
	open?: boolean;
}) {
	return (
		<details class="tool-section" open={props.open ?? true}>
			<summary>
				<ChevronIcon size={16} nobox aria-hidden="true" />
				<span>{props.title}</span>
			</summary>
			<div class="tool-section-content">{props.children}</div>
		</details>
	);
}
