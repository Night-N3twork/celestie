import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { EditorSettings } from "../../settings/editorSettings";
import type { EditorSession } from "../core/editor";
import type { Selection } from "../core/selection";
import { indentSelection } from "./indentation";
import { LineIndex } from "./lineIndex";
import {
	displayOffset,
	displayText,
	documentOffset,
	inputEdit,
} from "./textInput";
import Viewport, { editorPadding } from "./Viewport";

const scrollPositions = new WeakMap<
	EditorSession,
	{ top: number; left: number }
>();

export default function Editor(props: {
	session: EditorSession;
	revision: number;
	settings: EditorSettings;
	readOnly: boolean;
	onChange: () => void;
	onSelectionChange: () => void;
	revealRequest: number;
	focusRequest: number;
}) {
	let input!: HTMLTextAreaElement;
	let restoredScroll = false;
	let renderedVersion = -1;
	let lastRevealRequest = props.revealRequest;
	let allowTabExit = false;
	const helpId = createUniqueId();
	const [renderText, setRenderText] = createSignal(
		displayText(props.session.snapshot.text),
	);
	const [selected, setSelected] = createSignal<Selection>({
		anchor: 0,
		head: 0,
	});
	const [scroll, setScroll] = createSignal({ top: 0, left: 0 });
	const [size, setSize] = createSignal({ height: 0, width: 0 });
	const [focused, setFocused] = createSignal(false);
	const [composing, setComposing] = createSignal(false);
	const [measuredLineHeight, setMeasuredLineHeight] = createSignal(
		props.settings.fontSize * 1.6,
	);
	const lines = createMemo(() => new LineIndex(renderText()));
	const lineHeight = measuredLineHeight;
	const measure = () => {
		const probe = input.cloneNode(false) as HTMLTextAreaElement;
		probe.style.cssText = `position:absolute;height:1px;width:100px;padding:0;border:0;visibility:hidden;pointer-events:none;font-size:${props.settings.fontSize}px;line-height:${props.settings.fontSize * 1.6}px`;
		probe.setAttribute("aria-hidden", "true");
		probe.tabIndex = -1;
		probe.value = Array(64).fill("x").join("\n");
		input.parentElement?.append(probe);
		setMeasuredLineHeight(probe.scrollHeight / 64);
		probe.remove();
		setSize({ height: input.clientHeight, width: input.clientWidth });
		savePosition();
	};
	const visibleNumbers = createMemo(() => {
		const start = Math.max(
			0,
			Math.floor((scroll().top - editorPadding) / lineHeight()) - 8,
		);
		const end = Math.min(
			lines().count,
			Math.ceil(
				(scroll().top + size().height - editorPadding) / lineHeight(),
			) + 8,
		);
		return Array.from(
			{ length: Math.max(0, end - start) },
			(_, index) => start + index,
		);
	});
	const selection = (): Selection =>
		input.selectionDirection === "backward"
			? { anchor: input.selectionEnd, head: input.selectionStart }
			: { anchor: input.selectionStart, head: input.selectionEnd };
	const syncSelection = () => {
		const current = selection();
		setSelected(current);
		if (
			!composing() &&
			input.value === displayText(props.session.snapshot.text)
		) {
			const text = props.session.snapshot.text;
			const next = {
				anchor: documentOffset(text, current.anchor),
				head: documentOffset(text, current.head),
			};
			const previous = props.session.selection;
			if (
				previous.anchor !== next.anchor ||
				previous.head !== next.head
			) {
				props.session.setSelection(next);
				props.onSelectionChange();
			}
		}
	};
	const savePosition = () => {
		const position = { top: input.scrollTop, left: input.scrollLeft };
		setScroll(position);
		scrollPositions.set(props.session, position);
	};
	const commit = () => {
		const before = props.session.snapshot.text;
		const edit = inputEdit(before, input.value);
		if (!edit) {
			setRenderText(input.value);
			syncSelection();
			return;
		}
		const next =
			before.slice(0, edit.from) + edit.text + before.slice(edit.to);
		const current = selection();
		props.session.apply({
			edit,
			selectionAfter: {
				anchor: documentOffset(next, current.anchor),
				head: documentOffset(next, current.head),
			},
		});
		setRenderText(input.value);
		setSelected(current);
		props.onChange();
	};
	const revealSelection = () => {
		const line = lines().lineAt(selection().head);
		const top = editorPadding + line * lineHeight();
		if (top < input.scrollTop)
			input.scrollTop = Math.max(0, top - editorPadding);
		else if (top + lineHeight() > input.scrollTop + input.clientHeight)
			input.scrollTop =
				top + lineHeight() - input.clientHeight + editorPadding;
		const probe = document.createElement("span");
		probe.style.cssText =
			"position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
		probe.textContent = input.value.slice(
			lines().starts[line],
			selection().head,
		);
		input.parentElement?.append(probe);
		const left = editorPadding + probe.getBoundingClientRect().width;
		probe.remove();
		if (left < input.scrollLeft + editorPadding)
			input.scrollLeft = Math.max(0, left - editorPadding);
		else if (
			left + 2 >
			input.scrollLeft + input.clientWidth - editorPadding
		)
			input.scrollLeft = left - input.clientWidth + editorPadding + 2;
		savePosition();
	};
	createEffect(
		on(
			() => [props.session, props.revision, props.revealRequest],
			() => {
				if (composing()) return;
				const text = props.session.snapshot.text;
				const version = props.session.snapshot.version;
				const edited =
					renderedVersion !== -1 && renderedVersion !== version;
				renderedVersion = version;
				const normalized = displayText(text);
				if (input.value !== normalized) input.value = normalized;
				setRenderText(normalized);
				const { anchor, head } = props.session.selection;
				input.setSelectionRange(
					displayOffset(text, Math.min(anchor, head)),
					displayOffset(text, Math.max(anchor, head)),
					head < anchor ? "backward" : "forward",
				);
				setSelected(selection());
				const saved = scrollPositions.get(props.session);
				if (saved && !restoredScroll) {
					input.scrollTop = saved.top;
					input.scrollLeft = saved.left;
				}
				restoredScroll = true;
				if (edited || lastRevealRequest !== props.revealRequest)
					revealSelection();
				lastRevealRequest = props.revealRequest;
				savePosition();
			},
		),
	);
	onMount(() => {
		const observer = new ResizeObserver(measure);
		observer.observe(input);
		measure();
		let disposed = false;
		void document.fonts.ready.then(() => {
			if (!disposed) measure();
		});
		onCleanup(() => {
			disposed = true;
			observer.disconnect();
			scrollPositions.set(props.session, {
				top: input.scrollTop,
				left: input.scrollLeft,
			});
		});
	});
	createEffect(
		on(
			() => props.settings.fontSize,
			() => measure(),
		),
	);
	createEffect(
		on(
			() => props.focusRequest,
			() => input.focus({ preventScroll: true }),
			{ defer: true },
		),
	);
	return (
		<div
			class="virtual-editor"
			classList={{ "editor-focused": focused() }}
			style={{
				"font-size": `${props.settings.fontSize}px`,
				"line-height": `${lineHeight()}px`,
				"tab-size": props.settings.tabSize,
			}}
		>
			<Show when={props.settings.lineNumbers}>
				<div
					class="virtual-gutter"
					aria-hidden="true"
					style={{
						width: `${lines().count.toString().length + 2}ch`,
						height: `${size().height}px`,
					}}
				>
					<For each={visibleNumbers()}>
						{(number) => (
							<div
								class="virtual-line-number"
								style={{
									top: `${editorPadding + number * lineHeight() - scroll().top}px`,
								}}
							>
								{number + 1}
							</div>
						)}
					</For>
				</div>
			</Show>
			<div class="editor-stage">
				<span id={helpId} class="editor-accessibility-help">
					Press Escape and Tab to move focus out of the editor.
				</span>
				<Viewport
					lines={lines()}
					selection={selected()}
					scrollTop={scroll().top}
					scrollLeft={scroll().left}
					height={size().height}
					width={size().width}
					lineHeight={lineHeight()}
					focused={focused()}
					composing={composing()}
				/>
				<textarea
					ref={input}
					class="editor-input"
					classList={{ composing: composing() }}
					aria-label="File contents"
					aria-describedby={helpId}
					readOnly={props.readOnly}
					spellcheck={false}
					autocapitalize="off"
					autocomplete="off"
					wrap="off"
					onFocus={() => {
						setFocused(true);
						syncSelection();
					}}
					onBlur={() => {
						setFocused(false);
						syncSelection();
					}}
					onScroll={savePosition}
					onSelect={syncSelection}
					onKeyUp={syncSelection}
					onPointerUp={syncSelection}
					onBeforeInput={(event) => {
						if (props.readOnly) return;
						syncSelection();
						if (
							!composing() &&
							event.cancelable &&
							(event.inputType === "insertLineBreak" ||
								event.inputType === "insertParagraph")
						) {
							event.preventDefault();
							const start = input.selectionStart;
							const first =
								start === 0
									? 0
									: input.value.lastIndexOf("\n", start - 1) +
										1;
							const indent =
								/^[\t ]*/.exec(
									input.value.slice(first, start),
								)?.[0] ?? "";
							input.setRangeText(
								`\n${indent}`,
								start,
								input.selectionEnd,
								"end",
							);
							commit();
						}
						if (
							event.inputType === "historyUndo" ||
							event.inputType === "historyRedo"
						) {
							event.preventDefault();
							if (event.inputType === "historyUndo")
								props.session.undo();
							else props.session.redo();
							props.onChange();
						}
					}}
					onInput={() => {
						if (composing()) {
							setRenderText(input.value);
							setSelected(selection());
						} else commit();
						savePosition();
					}}
					onCompositionStart={() => {
						syncSelection();
						setComposing(true);
					}}
					onCompositionEnd={() => {
						setComposing(false);
						commit();
						savePosition();
					}}
					onKeyDown={(event) => {
						if (props.readOnly || event.isComposing || composing())
							return;
						if (event.key === "Escape") {
							allowTabExit = true;
							return;
						}
						if (event.key === "Tab" && allowTabExit) {
							allowTabExit = false;
							return;
						}
						allowTabExit = false;
						syncSelection();
						if (
							event.key === "Tab" &&
							!event.ctrlKey &&
							!event.metaKey &&
							!event.altKey
						) {
							event.preventDefault();
							const direction = input.selectionDirection;
							const result = indentSelection(
								input.value,
								input.selectionStart,
								input.selectionEnd,
								props.settings,
								event.shiftKey,
							);
							input.value = result.text;
							input.setSelectionRange(
								result.start,
								result.end,
								direction,
							);
							commit();
						}
					}}
				/>
			</div>
		</div>
	);
}
