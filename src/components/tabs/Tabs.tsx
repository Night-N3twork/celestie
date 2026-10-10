import Page from "@components/Page";
import {
	createEffect,
	createSignal,
	createUniqueId,
	For,
	Show,
} from "solid-js";
import { newDrag } from "./drag";
import type { TabsController } from "./model";
import { newScrollbar } from "./scrollbar";
import * as styles from "./Tabs.css";

export default function Tabs(props: { tabs: TabsController }) {
	const prefix = createUniqueId();
	const buttons = new Map<number, HTMLButtonElement>();
	const elements = new Map<number, HTMLDivElement>();
	let bar!: HTMLDivElement;
	let list!: HTMLDivElement;
	const drag = newDrag({
		tabs: props.tabs,
		elements,
		bar: () => bar,
		list: () => list,
	});
	const [hovering, setHovering] = createSignal(false);
	const [scrollable, setScrollable] = createSignal(false);
	let track!: HTMLDivElement;
	let thumb!: HTMLDivElement;
	const scrollbar = newScrollbar({
		list: () => list,
		track: () => track,
		thumb: () => thumb,
		scrollable: setScrollable,
	});
	let add: HTMLButtonElement | undefined;
	const tabId = (id: number) => `${prefix}-tab-${id}`;
	const panelId = (id: number) => `${prefix}-panel-${id}`;

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
		<div class={styles.workspace}>
			<div
				ref={bar}
				class={styles.bar}
				data-dragging={!!drag.view()}
				onPointerEnter={() => setHovering(true)}
				onPointerLeave={() => setHovering(false)}
			>
				<div
					ref={list}
					class={styles.list}
					role="tablist"
					aria-label="Open files"
				>
					<For each={props.tabs.state().tabs}>
						{(tab) => (
							<div
								ref={(element) => elements.set(tab.id, element)}
								role="presentation"
								class={styles.tab}
								data-active={
									props.tabs.state().activeId === tab.id
								}
								data-dragging={drag.view()?.id === tab.id}
								data-preview={!!drag.view()}
								style={{
									transform:
										drag.offset(tab.id) === undefined
											? undefined
											: `translateX(${drag.offset(tab.id)}px)`,
								}}
							>
								<button
									ref={(element) =>
										buttons.set(tab.id, element)
									}
									type="button"
									role="tab"
									id={tabId(tab.id)}
									aria-controls={
										props.tabs.state().activeId === tab.id
											? panelId(tab.id)
											: undefined
									}
									aria-selected={
										props.tabs.state().activeId === tab.id
									}
									tabIndex={
										props.tabs.state().activeId === tab.id
											? 0
											: -1
									}
									class={styles.select}
									title={`${tab.title}`}
									onClick={() => {
										if (!drag.suppress(tab.id))
											props.tabs.select(tab.id);
									}}
									onPointerDown={(event) =>
										drag.start(event, tab.id)
									}
									onKeyDown={(event) =>
										keyDown(event, tab.id)
									}
								>
									{tab.title}
								</button>
								<button
									type="button"
									class={styles.close}
									tabIndex={-1}
									aria-label={`Close ${tab.title}`}
									title={`Close ${tab.title}`}
									onClick={() => close(tab.id)}
								>
									×
								</button>
							</div>
						)}
					</For>
				</div>
				<Show when={drag.view()}>
					{(view) => (
						<div
							class={styles.insertionLine}
							aria-hidden="true"
							data-insertion-index={view().gap}
							style={{ left: `${view().line}px` }}
						/>
					)}
				</Show>
				<div
					ref={track}
					class={styles.track}
					aria-hidden="true"
					data-show={hovering() && scrollable()}
				>
					<div
						ref={thumb}
						class={styles.thumb}
						data-show={hovering() && scrollable()}
						onPointerDown={(event) => scrollbar.grabThumb(event)}
					/>
				</div>
				<button
					ref={add}
					type="button"
					class={styles.add}
					aria-label="New tab"
					title="New tab"
					onClick={newTab}
				>
					+
				</button>
			</div>
			<Show when={props.tabs.active()}>
				{(active) => (
					<div
						class={styles.panel}
						role="tabpanel"
						id={panelId(active().id)}
						aria-labelledby={tabId(active().id)}
					>
						<Page title={active().title} />
					</div>
				)}
			</Show>
		</div>
	);
}
