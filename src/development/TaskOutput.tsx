import Anser from "anser";
import { createEffect, createMemo, For } from "solid-js";
import stripAnsi from "strip-ansi";

export default function TaskOutput(props: { text: string; visible: boolean }) {
	let log!: HTMLPreElement;
	let follow = true;
	const chunks = createMemo(() =>
		Anser.ansiToJson(props.text, { remove_empty: true }),
	);
	const color = (value: string) =>
		value && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(value)
			? `rgb(${value})`
			: undefined;
	createEffect(() => {
		props.text;
		props.visible;
		queueMicrotask(() => {
			if (follow && log) log.scrollTop = log.scrollHeight;
		});
	});
	return (
		<pre
			class="task-output"
			aria-label="Task output"
			role="log"
			hidden={!props.visible}
			ref={log}
			onScroll={() => {
				follow =
					log.scrollHeight - log.clientHeight - log.scrollTop < 24;
			}}
		>
			<For each={chunks()}>
				{(chunk) => (
					<span
						style={{
							color: color(chunk.fg_truecolor || chunk.fg),
							"background-color": color(
								chunk.bg_truecolor || chunk.bg,
							),
							"font-weight": chunk.decorations.includes("bold")
								? "700"
								: undefined,
							"font-style": chunk.decorations.includes("italic")
								? "italic"
								: undefined,
							opacity: chunk.decorations.includes("dim")
								? "0.7"
								: undefined,
							"text-decoration":
								[
									chunk.decorations.includes("underline")
										? "underline"
										: "",
									chunk.decorations.includes("strikethrough")
										? "line-through"
										: "",
								]
									.filter(Boolean)
									.join(" ") || undefined,
						}}
					>
						{stripAnsi(chunk.content)}
					</span>
				)}
			</For>
		</pre>
	);
}
