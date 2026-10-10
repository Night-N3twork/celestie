// :3

import { createSignal, onCleanup } from "solid-js";
import type { Tab, TabsController } from "./model";

interface Bounds {
	left: number;
	width: number;
}

export function index(bounds: Bounds[], x: number) {
	const index = bounds.findIndex((tab) => x < tab.left + tab.width / 2);
	return index === -1 ? bounds.length : index;
}

export function target(tabs: Tab[], id: number, gap: number) {
	const from = tabs.findIndex((tab) => tab.id === id);
	if (from === -1 || gap < 0 || gap > tabs.length) return undefined;
	const to = gap > from ? gap - 1 : gap;
	return to === from ? undefined : tabs[to]?.id;
}

export function layout(bounds: Bounds[], from: number, to: number) {
	const width = bounds[from].width;
	const offsets = bounds.map((_, index) => {
		if (to > from && index > from && index <= to) return -width;
		if (to < from && index >= to && index < from) return width;
		return 0;
	});
	const line = bounds[to].left + (to > from ? bounds[to].width - width : 0);
	return { offsets, line };
}

interface DragView {
	id: number;
	offset: number;
	gap: number;
	line: number;
	shifts: Map<number, number>;
}

export function newDrag(options: {
	tabs: TabsController;
	list: () => HTMLDivElement;
	bar: () => HTMLDivElement;
	elements: Map<number, HTMLDivElement>;
}) {
	const [view, setView] = createSignal<DragView | null>(null);
	let session: {
		id: number;
		pointerId: number;
		button: HTMLButtonElement;
		startX: number;
		x: number;
		grabOffset: number;
	} | null = null;
	let frame = 0;
	let suppressedId: number | null = null;
	let clickTimer: ReturnType<typeof setTimeout> | undefined;

	function bounds() {
		return options.tabs.state().tabs.map((tab) => {
			const element = options.elements.get(tab.id);
			const rect = element?.getBoundingClientRect();
			const transform = element
				? getComputedStyle(element).transform
				: "none";
			const offset =
				transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
			return {
				left: (rect?.left ?? 0) - offset,
				width: rect?.width ?? 0,
			};
		});
	}

	function update() {
		if (!session) return;
		const tabs = options.tabs.state().tabs;
		const rects = bounds();
		const from = tabs.findIndex((tab) => tab.id === session?.id);
		const source = rects[from];
		if (!source) return;
		const list = options.list().getBoundingClientRect();
		const left = Math.max(
			list.left,
			Math.min(session.x - session.grabOffset, list.right - source.width),
		);
		const center = Math.max(
			list.left,
			Math.min(
				session.x - session.grabOffset + source.width / 2,
				list.right,
			),
		);
		const to = index(
			rects.filter((_, index) => index !== from),
			center,
		);
		const preview = layout(rects, from, to);
		const gap = to > from ? to + 1 : to;
		setView({
			id: session.id,
			offset: left - source.left,
			gap,
			line:
				Math.max(list.left, Math.min(preview.line, list.right)) -
				options.bar().getBoundingClientRect().left,
			shifts: new Map(
				tabs.map((tab, index) => [tab.id, preview.offsets[index]]),
			),
		});
	}

	function scroll() {
		if (!session || !view()) return;
		const list = options.list();
		const rect = list.getBoundingClientRect();
		const margin = Math.min(36, rect.width / 4);
		const speed =
			session.x < rect.left + margin
				? -Math.min(14, (rect.left + margin - session.x) / 3)
				: session.x > rect.right - margin
					? Math.min(14, (session.x - rect.right + margin) / 3)
					: 0;
		const previous = list.scrollLeft;
		list.scrollLeft += speed;
		if (list.scrollLeft !== previous) update();
		frame = requestAnimationFrame(scroll);
	}

	function refresh() {
		if (view()) update();
	}

	function suppressClick(id: number) {
		suppressedId = id;
		clearTimeout(clickTimer);
		clickTimer = setTimeout(() => {
			suppressedId = null;
		}, 0);
	}

	function cancel() {
		const current = session;
		if (!current) return;
		if (view()) suppressClick(current.id);
		session = null;
		cancelAnimationFrame(frame);
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", finish);
		document.removeEventListener("pointercancel", cancel);
		document.removeEventListener("keydown", keyDown);
		window.removeEventListener("blur", cancel);
		window.removeEventListener("resize", refresh);
		options.list().removeEventListener("scroll", refresh);
		current.button.removeEventListener("lostpointercapture", cancel);
		if (current.button.hasPointerCapture(current.pointerId))
			current.button.releasePointerCapture(current.pointerId);
		setView(null);
	}

	function move(event: PointerEvent) {
		if (!session || event.pointerId !== session.pointerId) return;
		session.x = event.clientX;
		if (!view() && Math.abs(session.x - session.startX) < 4) return;
		event.preventDefault();
		const starting = !view();
		update();
		if (starting) frame = requestAnimationFrame(scroll);
	}

	function finish(event: PointerEvent) {
		if (!session || event.pointerId !== session.pointerId) return;
		if (view()) {
			session.x = event.clientX;
			update();
			const t = target(
				options.tabs.state().tabs,
				session.id,
				view()?.gap ?? 0,
			);
			if (t !== undefined) options.tabs.move(session.id, t);
		}
		cancel();
	}

	function keyDown(event: KeyboardEvent) {
		if (event.key !== "Escape") return;
		event.preventDefault();
		cancel();
	}

	onCleanup(() => {
		cancel();
		clearTimeout(clickTimer);
	});

	return {
		view,
		offset: (id: number) => {
			const current = view();
			if (!current) return undefined;
			return current.id === id
				? current.offset
				: (current.shifts.get(id) ?? 0);
		},
		cancel,
		suppress: (id: number) => suppressedId === id,
		start: (
			event: PointerEvent & { currentTarget: HTMLButtonElement },
			id: number,
		) => {
			if (event.button !== 0 || !event.isPrimary) return;
			cancel();
			const element = options.elements.get(id);
			if (!element) return;
			session = {
				id,
				pointerId: event.pointerId,
				button: event.currentTarget,
				startX: event.clientX,
				x: event.clientX,
				grabOffset:
					event.clientX - element.getBoundingClientRect().left,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
			event.currentTarget.addEventListener("lostpointercapture", cancel);
			document.addEventListener("pointermove", move, { passive: false });
			document.addEventListener("pointerup", finish);
			document.addEventListener("pointercancel", cancel);
			document.addEventListener("keydown", keyDown);
			window.addEventListener("blur", cancel);
			window.addEventListener("resize", refresh);
			options.list().addEventListener("scroll", refresh);
		},
	};
}
