import { type JSX, Show } from "solid-js";

export function Tooltip(props: {
	text: string;
	shortcut?: string;
	id?: string;
	enabled?: boolean;
	full?: boolean;
	children: JSX.Element;
}) {
	return (
		<div class="tooltip" style={props.full ? { width: "100%" } : undefined}>
			{props.children}
			<Show when={props.enabled !== false}>
				<span id={props.id} class="tooltip-tip" role="tooltip">
					{props.text}
					<Show when={props.shortcut}>
						<kbd class="tooltip-shortcut">{props.shortcut}</kbd>
					</Show>
				</span>
			</Show>
		</div>
	);
}
