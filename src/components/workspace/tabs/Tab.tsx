import { Close } from "@icons/embed/Tabs";
import type { JSX } from "solid-js";
import type { Tab as TabModel } from "./model";

export default function Tab(props: {
	tab: TabModel;
	active: boolean;
	dragging: boolean;
	preview: boolean;
	offset: number | undefined;
	id: string;
	panelId: string;
	ref: (element: HTMLDivElement) => void;
	buttonRef: (element: HTMLButtonElement) => void;
	onSelect: () => void;
	onPointerDown: JSX.EventHandler<HTMLButtonElement, PointerEvent>;
	onKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
	onClose: () => void;
}) {
	return (
		<div
			ref={props.ref}
			role="presentation"
			class="tabs-tab"
			data-active={props.active}
			data-dragging={props.dragging}
			data-preview={props.preview}
			style={{
				transform:
					props.offset === undefined
						? undefined
						: `translateX(${props.offset}px)`,
			}}
		>
			<button
				ref={props.buttonRef}
				type="button"
				role="tab"
				id={props.id}
				aria-controls={props.active ? props.panelId : undefined}
				aria-selected={props.active}
				tabIndex={props.active ? 0 : -1}
				class="tabs-select"
				title={props.tab.title}
				onClick={props.onSelect}
				onPointerDown={props.onPointerDown}
				onKeyDown={props.onKeyDown}
			>
				{props.tab.title}
			</button>
			<button
				type="button"
				class="tabs-close"
				tabIndex={-1}
				aria-label={`Close ${props.tab.title}`}
				title={`Close ${props.tab.title}`}
				onClick={props.onClose}
			>
				<Close size={8} />
			</button>
		</div>
	);
}
