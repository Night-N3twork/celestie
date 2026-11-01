import type { JSX } from "solid-js";
import RemoveIcon from "../icons/actions/remove.svg";
import ActionButton from "./ActionButton";

export default function ToolWindowHeader(props: {
	title: string;
	onHide: () => void;
	children?: JSX.Element;
}) {
	return (
		<header class="tool-window-header">
			<span class="tool-window-title">{props.title}</span>
			<div class="tool-window-actions">
				{props.children}
				<ActionButton
					icon={RemoveIcon}
					label={`Hide ${props.title}`}
					compact
					onClick={props.onHide}
				/>
			</div>
		</header>
	);
}
