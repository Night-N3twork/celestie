import { Plus } from "@icons/embed/Tabs";
import { createEffect, createSignal, For } from "solid-js";
import { newDrag } from "./drag";
import type { TabsController } from "./model";
import { newScrollbar } from "./scrollbar";
import Tab from "./Tab";

export default function Tabs(props: { tabs: TabsController; prefix: string }) {
	const buttons = new Map<number, HTMLButtonElement>();
	const elements = new Map<number, HTMLDivElement>();
	let tabs!: HTMLDivElement;
	const drag = newDrag({
		tabs: props.tabs,
		elements,
		list: () => tabs,
	});
	const [hovering, setHovering] = createSignal(false);
	const [scrollable, setScrollable] = createSignal(false);
	let track!: HTMLDivElement;
	let thumb!: HTMLDivElement;
	const scrollbar = newScrollbar({
		list: () => tabs,
		track: () => track,
		thumb: () => thumb,
		scrollable: setScrollable,
	});
	let add: HTMLButtonElement | undefined;
	const tabId = (id: number) => `${props.prefix}-tab-${id}`;
	const panelId = (id: number) => `${props.prefix}-panel-${id}`;

	function focusActive() {
		queueMicrotask(() => {
			const id = props.tabs.state().activeId;
			const button = id === null ? add : buttons.get(id);
			button?.focus();
		});
	}

	function newTab() {
		props.tabs.add();
		focusActive();
	}

	function close(id: number) {
		drag.cancel();
		props.tabs.close(id);
		buttons.delete(id);
		elements.delete(id);
		focusActive();
	}

	function keyDown(event: KeyboardEvent, id: number) {
		const tabs = props.tabs.state().tabs;
		const index = tabs.findIndex((tab) => tab.id === id);
		let target: number;
		switch (event.key) {
			case "ArrowLeft":
				target = (index - 1 + tabs.length) % tabs.length;
				break;
			case "ArrowRight":
				target = (index + 1) % tabs.length;
				break;
			case "Home":
				target = 0;
				break;
			case "End":
				target = tabs.length - 1;
				break;
			case "Delete":
				event.preventDefault();
				close(id);
				return;
			default:
				return;
		}
		event.preventDefault();
		if (
			event.altKey &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight")
		) {
			const neighbor = tabs[index + (event.key === "ArrowLeft" ? -1 : 1)];
			if (neighbor) props.tabs.move(id, neighbor.id);
		} else {
			props.tabs.select(tabs[target].id);
		}
		focusActive();
	}

	createEffect(() => {
		const { activeId, tabs } = props.tabs.state();
		scrollbar.refresh();
		if (activeId === null || tabs.length === 0) return;
		queueMicrotask(() =>
			buttons
				.get(activeId)
				?.scrollIntoView({ block: "nearest", inline: "nearest" }),
		);
	});

	return (
		<div
			ref={tabs}
			class="tabs"
			role="tablist"
			data-dragging={!!drag.view()}
			onPointerEnter={() => setHovering(true)}
			onPointerLeave={() => setHovering(false)}
		>
			<For each={props.tabs.state().tabs}>
				{(tab) => (
					<Tab
						tab={tab}
						active={props.tabs.state().activeId === tab.id}
						dragging={drag.view()?.id === tab.id}
						preview={!!drag.view()}
						offset={drag.offset(tab.id)}
						id={tabId(tab.id)}
						panelId={panelId(tab.id)}
						ref={(element) => elements.set(tab.id, element)}
						buttonRef={(element) => buttons.set(tab.id, element)}
						onSelect={() => {
							if (!drag.suppress(tab.id))
								props.tabs.select(tab.id);
						}}
						onPointerDown={(event) => {
							if (event.button !== 0 || !event.isPrimary) return;
							props.tabs.select(tab.id);
							drag.start(event, tab.id);
						}}
						onKeyDown={(event) => keyDown(event, tab.id)}
						onClose={() => close(tab.id)}
					/>
				)}
			</For>
			<div
				ref={track}
				class="scroll-track"
				aria-hidden="true"
				data-show={hovering() && scrollable()}
			>
				<div
					ref={thumb}
					class="thumb"
					data-show={hovering() && scrollable()}
					onPointerDown={(event) => scrollbar.grabThumb(event)}
				/>
			</div>
			<button
				ref={add}
				type="button"
				class="tabs-add"
				aria-label="New tab"
				title="New tab"
				onClick={newTab}
			>
				<Plus size={12} />
			</button>
		</div>
	);
}
