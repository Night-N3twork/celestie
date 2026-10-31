import { createEffect, createMemo, on, Show } from "solid-js";
import type { EditorSettings } from "../../settings/editorSettings";
import type { EditorSession } from "../core/editor";
import {
	displayOffset,
	displayText,
	documentOffset,
	inputEdit,
} from "./textInput";

export default function Editor(props: {
	session: EditorSession;
	revision: number;
	settings: EditorSettings;
	readOnly: boolean;
	onChange: () => void;
}) {
	let input!: HTMLTextAreaElement;
	let gutter!: HTMLPreElement;
	const lines = createMemo(() => {
		props.revision;
		return Array.from(
			{
				length: displayText(props.session.snapshot.text).split("\n")
					.length,
			},
			(_, index) => index + 1,
		).join("\n");
	});
	let composing = false;
	const selection = () => {
		const {
			selectionStart: start,
			selectionEnd: end,
			selectionDirection,
		} = input;
		return selectionDirection === "backward"
			? { anchor: end, head: start }
			: { anchor: start, head: end };
	};
	const syncSelection = () => {
		if (
			!composing &&
			input.value === displayText(props.session.snapshot.text)
		) {
			const selected = selection();
			props.session.setSelection({
				anchor: documentOffset(
					props.session.snapshot.text,
					selected.anchor,
				),
				head: documentOffset(
					props.session.snapshot.text,
					selected.head,
				),
			});
		}
	};
	const commit = () => {
		const before = props.session.snapshot.text;
		const edit = inputEdit(before, input.value);
		if (!edit) return syncSelection();
		const next =
			before.slice(0, edit.from) + edit.text + before.slice(edit.to);
		const selected = selection();
		props.session.apply({
			edit,
			selectionAfter: {
				anchor: documentOffset(next, selected.anchor),
				head: documentOffset(next, selected.head),
			},
		});
		props.onChange();
	};
	createEffect(
		on(
			() => [props.session, props.revision],
			() => {
				if (composing) return;
				const text = props.session.snapshot.text;
				if (input.value !== displayText(text))
					input.value = displayText(text);
				const { anchor, head } = props.session.selection;
				input.setSelectionRange(
					displayOffset(text, Math.min(anchor, head)),
					displayOffset(text, Math.max(anchor, head)),
					head < anchor ? "backward" : "forward",
				);
			},
		),
	);
	return (
		<div
			class="editor-surface"
			style={{ "font-size": `${props.settings.fontSize}px` }}
		>
			<Show when={props.settings.lineNumbers}>
				<pre ref={gutter} class="editor-gutter" aria-hidden="true">
					{lines()}
				</pre>
			</Show>
			<textarea
				ref={input}
				class="editor-input"
				aria-label="File contents"
				readOnly={props.readOnly}
				spellcheck={false}
				wrap="off"
				onScroll={() => {
					if (gutter) gutter.scrollTop = input.scrollTop;
				}}
				style={{
					"font-size": `${props.settings.fontSize}px`,
					"tab-size": props.settings.tabSize,
				}}
				onSelect={syncSelection}
				onBeforeInput={(event) => {
					syncSelection();
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
					if (!composing) commit();
				}}
				onCompositionStart={() => {
					syncSelection();
					composing = true;
				}}
				onCompositionEnd={() => {
					composing = false;
					commit();
				}}
				onKeyDown={(event) => {
					if (event.isComposing || composing) return;
					if (event.key === "Tab" && !event.shiftKey) {
						event.preventDefault();
						input.setRangeText(
							props.settings.insertSpaces
								? " ".repeat(props.settings.tabSize)
								: "\t",
							input.selectionStart,
							input.selectionEnd,
							"end",
						);
						commit();
					}
				}}
			/>
		</div>
	);
}
