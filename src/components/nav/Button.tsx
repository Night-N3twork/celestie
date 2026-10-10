import { Tooltip } from "@components/Tooltip";
import type { shortcuts } from "@utils/shortcuts.ts";
import {
	type Component,
	createUniqueId,
	type JSX,
	Show,
	splitProps,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { full, main, size, svg, text } from "./Button.css";

export interface ButtonOptions
	extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	size: "sm" | "md" | "lg";
	text?: string | boolean;
	full?: boolean;
	name: string;
	svg?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
	shortcuts?: shortcuts;
}

function formatShortcut(list?: shortcuts) {
	const first = list?.[0];
	return first ? [...first.mod, ...first.key].join("+") : undefined;
}

export default function Button(allProps: ButtonOptions) {
	const [props, attributes] = splitProps(allProps, [
		"size",
		"text",
		"full",
		"name",
		"svg",
		"shortcuts",
		"class",
		"aria-describedby",
	]);
	const label = () =>
		typeof props.text === "string" && props.text.length > 0
			? props.text
			: props.name;
	const hasText = () =>
		typeof props.text === "string"
			? props.text.length > 0
			: props.text === true;
	const shortcut = () => formatShortcut(props.shortcuts);
	const hasTooltip = () => !hasText() || !!shortcut();
	const tooltipId = createUniqueId();

	return (
		<Tooltip
			text={label()}
			shortcut={shortcut()}
			id={tooltipId}
			enabled={hasTooltip()}
			full={props.full}
		>
			<button
				type="button"
				aria-label={label()}
				aria-keyshortcuts={
					props.shortcuts
						?.map((entry) =>
							[
								...entry.mod.map((mod) =>
									mod === "Ctrl" ? "Control" : mod,
								),
								...entry.key,
							].join("+"),
						)
						.join(" ") || undefined
				}
				{...attributes}
				aria-describedby={
					[
						props["aria-describedby"],
						hasTooltip() ? tooltipId : undefined,
					]
						.filter(Boolean)
						.join(" ") || undefined
				}
				class={[
					main,
					size[props.size],
					hasText() ? text : null,
					props.svg ? svg : null,
					props.full ? full : null,
					props.class,
				]
					.filter(Boolean)
					.join(" ")}
			>
				<Show when={props.svg}>
					{(icon) => (
						<Dynamic component={icon()} aria-hidden="true" />
					)}
				</Show>
				<Show when={hasText()}>
					<span>{label()}</span>
				</Show>
			</button>
		</Tooltip>
	);
}
