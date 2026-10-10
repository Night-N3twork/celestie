import { onCleanup, onMount } from "solid-js";

export interface ThumbGeometry {
	visible: boolean;
	left: number;
	width: number;
}

export function scrollThumb(
	scrollLeft: number,
	scrollWidth: number,
	clientWidth: number,
	trackWidth: number,
): ThumbGeometry {
	const hidden = { visible: false, left: 0, width: 0 };
	if (!(trackWidth > 0) || !(clientWidth > 0) || !(scrollWidth > 0))
		return hidden;
	const maxScroll = scrollWidth - clientWidth;
	if (maxScroll <= 1) return hidden;
	const width = Math.max((clientWidth / scrollWidth) * trackWidth, 24);
	const travel = Math.max(trackWidth - width, 0);
	const clamped = Math.max(0, Math.min(scrollLeft, maxScroll));
	return { visible: true, left: (clamped / maxScroll) * travel, width };
}

export function newScrollbar(options: {
	list: () => HTMLDivElement | undefined;
	track: () => HTMLDivElement | undefined;
	thumb: () => HTMLDivElement | undefined;
	scrollable: (scrollable: boolean) => void;
}) {
	let frame = 0;
	let observer: ResizeObserver | undefined;
	const lifetime = new AbortController();

	function render() {
		const list = options.list();
		const track = options.track();
		const thumb = options.thumb();
		if (!list || !track || !thumb) return;
		const bar = track.parentElement;
		if (bar) {
			const barRect = bar.getBoundingClientRect();
			const listRect = list.getBoundingClientRect();
			track.style.left = `${listRect.left - barRect.left}px`;
			track.style.width = `${listRect.width}px`;
		}
		const geometry = scrollThumb(
			list.scrollLeft,
			list.scrollWidth,
			list.clientWidth,
			track.clientWidth,
		);
		options.scrollable(geometry.visible);
		thumb.style.left = `${geometry.left}px`;
		thumb.style.width = `${geometry.width}px`;
	}

	function schedule() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(render);
	}

	function grabThumb(event: PointerEvent) {
		const list = options.list();
		const track = options.track();
		const thumb = options.thumb();
		if (!list || !track || !thumb) return;
		if (event.button !== 0 || !event.isPrimary) return;
		event.preventDefault();
		const maxScroll = list.scrollWidth - list.clientWidth;
		const travel = Math.max(
			track.clientWidth - thumb.getBoundingClientRect().width,
			1,
		);
		const scale = maxScroll / travel;
		const startX = event.clientX;
		const startScroll = list.scrollLeft;
		const drag = new AbortController();
		thumb.setPointerCapture(event.pointerId);
		thumb.addEventListener(
			"pointermove",
			(move: PointerEvent) => {
				if (move.pointerId !== event.pointerId) return;
				list.scrollLeft = startScroll + (move.clientX - startX) * scale;
			},
			{ signal: drag.signal },
		);
		const release = (up: PointerEvent) => {
			if (up.pointerId !== event.pointerId) return;
			drag.abort();
		};
		thumb.addEventListener("pointerup", release, { signal: drag.signal });
		thumb.addEventListener("pointercancel", release, {
			signal: drag.signal,
		});
	}

	onMount(() => {
		const list = options.list();
		if (list) {
			list.addEventListener("scroll", schedule, {
				passive: true,
				signal: lifetime.signal,
			});
			list.addEventListener(
				"wheel",
				(event: WheelEvent) => {
					if (event.ctrlKey) return;
					if (Math.abs(event.deltaY) <= Math.abs(event.deltaX))
						return;
					if (list.scrollWidth <= list.clientWidth + 1) return;
					event.preventDefault();
					const vertical =
						event.deltaMode === 1
							? event.deltaY * 16
							: event.deltaY;
					list.scrollLeft += vertical;
				},
				{ passive: false, signal: lifetime.signal },
			);
			observer = new ResizeObserver(schedule);
			observer.observe(list);
		}
		window.addEventListener("resize", schedule, {
			signal: lifetime.signal,
		});
		schedule();
	});

	onCleanup(() => {
		lifetime.abort();
		observer?.disconnect();
		cancelAnimationFrame(frame);
	});

	return { refresh: schedule, grabThumb };
}
