import type { Component, JSX } from "solid-js";
import type { SVGProps } from "../icons/icons";

export default function ActionButton(props: {
	label: string;
	icon?: Component<SVGProps>;
	onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
	disabled?: boolean;
	compact?: boolean;
	primary?: boolean;
}) {
	return (
		<button
			type="button"
			class="action-button"
			classList={{ "icon-button": props.compact, primary: props.primary }}
			aria-label={props.label}
			title={props.label}
			disabled={props.disabled}
			onClick={props.onClick}
		>
			{props.icon && <props.icon size={24} nobox aria-hidden="true" />}
			{!props.compact && <span>{props.label}</span>}
		</button>
	);
}
