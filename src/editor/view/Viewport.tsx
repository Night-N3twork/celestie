import { createMemo, For, Show } from "solid-js";
import type { Selection } from "../core/selection";
import type { LineIndex } from "./lineIndex";

export const editorPadding = 16;
const overscan = 8;

export default function Viewport(props: {
	lines: LineIndex;
	selection: Selection;
	secondary: readonly Selection[];
	scrollTop: number;
	scrollLeft: number;
	height: number;
	width: number;
	lineHeight: number;
	focused: boolean;
	composing: boolean;
}) {
	const visible = createMemo(() => {
		const start = Math.max(
			0,
			Math.floor((props.scrollTop - editorPadding) / props.lineHeight) -
				overscan,
		);
		const end = Math.min(
			props.lines.count,
			Math.ceil(
				(props.scrollTop + props.height - editorPadding) /
					props.lineHeight,
			) + overscan,
		);
		return Array.from(
			{ length: Math.max(0, end - start) },
			(_, offset) => start + offset,
		);
	});
	const pieces = (number: number) => {
		const text = props.lines.line(number);
		const start = props.lines.starts[number];
		const from = Math.max(
			0,
			Math.min(
				text.length,
				Math.min(props.selection.anchor, props.selection.head) - start,
			),
		);
		const to = Math.max(
			0,
			Math.min(
				text.length,
				Math.max(props.selection.anchor, props.selection.head) - start,
			),
		);
		const caret = props.selection.head - start;
		const extra = props.secondary.flatMap((selection) => [
			Math.max(0, Math.min(text.length, selection.anchor - start)),
			Math.max(0, Math.min(text.length, selection.head - start)),
		]);
		const cuts = [
			...new Set([
				0,
				text.length,
				from,
				to,
				...(caret >= 0 && caret <= text.length ? [caret] : []),
				...extra,
			]),
		].sort((a, b) => a - b);
		return cuts.map((offset, index) => ({
			offset,
			text: text.slice(offset, cuts[index + 1] ?? text.length),
			selected:
				(offset >= from && offset < to) ||
				props.secondary.some(
					(selection) =>
						offset + start >=
							Math.min(selection.anchor, selection.head) &&
						offset + start <
							Math.max(selection.anchor, selection.head),
				),
			caret:
				(offset === caret ||
					props.secondary.some(
						(selection) => selection.head === offset + start,
					)) &&
				props.focused &&
				!props.composing,
		}));
	};
	const newlineSelected = (number: number) =>
		number < props.lines.count - 1 &&
		[props.selection, ...props.secondary].some(
			(selection) =>
				Math.min(selection.anchor, selection.head) <=
					props.lines.ends[number] &&
				Math.max(selection.anchor, selection.head) >
					props.lines.ends[number],
		);
	return (
		<div
			class="virtual-paint"
			aria-hidden="true"
			style={{
				height: `${props.height}px`,
				width: `${props.width}px`,
				visibility: props.composing ? "hidden" : "visible",
			}}
		>
			<For each={visible()}>
				{(number) => (
					<div
						class="virtual-line"
						data-line={number + 1}
						style={{
							top: `${editorPadding + number * props.lineHeight - props.scrollTop}px`,
							left: `${editorPadding - props.scrollLeft}px`,
							height: `${props.lineHeight}px`,
						}}
					>
						<For each={pieces(number)}>
							{(piece) => (
								<>
									<Show when={piece.caret}>
										<span class="virtual-caret" />
									</Show>
									<span
										classList={{
											"virtual-selected": piece.selected,
										}}
									>
										{piece.text}
									</span>
								</>
							)}
						</For>
						<Show when={newlineSelected(number)}>
							<span class="virtual-selected"> </span>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
}
