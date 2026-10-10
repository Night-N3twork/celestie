import { type JSX, Show } from "solid-js";
import { main, shortcut, tip } from "./Tooltip.css";

export function Tooltip(props: {
	text: string;
	shortcut?: string;
	id?: string;
	enabled?: boolean;
	full?: boolean;
	children: JSX.Element;
}) {
	return (
		<div class={main} style={props.full ? { width: "100%" } : undefined}>
			{props.children}
			<Show when={props.enabled !== false}>
				<span id={props.id} class={tip} role="tooltip">
					{props.text}
					<Show when={props.shortcut}>
						<kbd class={shortcut}>{props.shortcut}</kbd>
					</Show>
				</span>
			</Show>
		</div>
	);
}
