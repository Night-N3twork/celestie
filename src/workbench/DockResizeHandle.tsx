import { onCleanup } from "solid-js";

export default function DockResizeHandle(props: {
	axis: "horizontal" | "vertical";
	label: string;
	value: number;
	min: number;
	max: () => number;
	onResize: (value: number) => void;
	reverse?: boolean;
}) {
	let cleanup: (() => void) | undefined;
	const resize = (value: number) =>
		props.onResize(Math.max(props.min, Math.min(props.max(), value)));
	onCleanup(() => cleanup?.());
	return (
		<hr
			class={`dock-resize dock-resize-${props.axis}`}
			aria-label={props.label}
			aria-orientation={
				props.axis === "horizontal" ? "vertical" : "horizontal"
			}
			aria-valuenow={Math.round(props.value)}
			aria-valuemin={props.min}
			aria-valuemax={Math.round(props.max())}
			tabIndex={0}
			onKeyDown={(event) => {
				const keys =
					props.axis === "horizontal"
						? ["ArrowLeft", "ArrowRight"]
						: ["ArrowUp", "ArrowDown"];
				if (!keys.includes(event.key)) return;
				event.preventDefault();
				resize(
					props.value +
						(event.key === keys[0] ? -16 : 16) *
							(props.reverse ? -1 : 1),
				);
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				cleanup?.();
				const start =
					props.axis === "horizontal" ? event.clientX : event.clientY;
				const initial = props.value;
				const move = (e: PointerEvent) =>
					resize(
						initial +
							((props.axis === "horizontal"
								? e.clientX
								: e.clientY) -
								start) *
								(props.reverse ? -1 : 1),
					);
				const previous = document.body.style.cursor;
				document.body.style.cursor =
					props.axis === "horizontal" ? "col-resize" : "row-resize";
				window.addEventListener("pointermove", move);
				cleanup = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", end);
					window.removeEventListener("pointercancel", end);
					window.removeEventListener("blur", end);
					document.body.style.cursor = previous;
					cleanup = undefined;
				};
				const end = () => cleanup?.();
				window.addEventListener("pointerup", end);
				window.addEventListener("pointercancel", end);
				window.addEventListener("blur", end);
			}}
		/>
	);
}
