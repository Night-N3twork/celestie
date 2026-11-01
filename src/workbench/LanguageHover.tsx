import { createSignal, onCleanup, Show } from "solid-js";
import type { Hover } from "vscode-languageserver-protocol";
import { positionAt } from "../language/lsp";
import type { WorkbenchController } from "./createWorkbenchController";

export default function LanguageHover(props: {
	controller: WorkbenchController;
	blocked: () => boolean;
}) {
	const c = props.controller;
	const [hover, setHover] = createSignal<{
		text: string;
		x: number;
		y: number;
	}>();
	let timer: ReturnType<typeof setTimeout> | undefined,
		generation = 0;
	const hide = () => {
		clearTimeout(timer);
		generation++;
		setHover(undefined);
	};
	const plain = (value: unknown): string =>
		typeof value === "string"
			? value
			: Array.isArray(value)
				? value.map(plain).join("\n\n")
				: value && typeof value === "object" && "value" in value
					? String(value.value)
					: "";
	const pointer = (event: PointerEvent) => {
		if (
			event.target instanceof Element &&
			event.target.closest(".language-hover")
		)
			return;
		hide();
		if (
			!c.language.host ||
			props.blocked() ||
			event.buttons ||
			!(event.target instanceof HTMLTextAreaElement) ||
			!event.target.classList.contains("editor-input")
		)
			return;
		const input = event.target,
			x = event.clientX,
			y = event.clientY,
			token = generation;
		timer = setTimeout(() => {
			void (async () => {
				const doc = c
					.documents()
					.find((doc) => doc.id === input.dataset.documentId);
				if (!doc) return;
				const offset = c.editorControls
					.get(doc.editor)
					?.offsetAtPoint(x, y);
				if (offset === undefined) return;
				const text = doc.editor.snapshot.text;
				await c.language.synchronize();
				const result = await c.language.host?.request<Hover | null>(
					doc.id,
					"textDocument/hover",
					{ position: positionAt(text, offset) },
				);
				if (
					token !== generation ||
					doc.editor.snapshot.text !== text ||
					!result
				)
					return;
				setHover({
					text: plain(result.contents),
					x: Math.max(8, Math.min(x, innerWidth - 468)),
					y: Math.max(8, Math.min(y + 18, innerHeight - 230)),
				});
			})().catch(() => {});
		}, 600);
	};
	window.addEventListener("pointermove", pointer);
	window.addEventListener("keydown", hide);
	window.addEventListener("scroll", hide, true);
	onCleanup(() => {
		hide();
		window.removeEventListener("pointermove", pointer);
		window.removeEventListener("keydown", hide);
		window.removeEventListener("scroll", hide, true);
	});
	return (
		<Show when={hover()}>
			{(value) => (
				<aside
					class="language-hover"
					role="tooltip"
					style={{ left: `${value().x}px`, top: `${value().y}px` }}
				>
					<pre>{value().text}</pre>
				</aside>
			)}
		</Show>
	);
}
