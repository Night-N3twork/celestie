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
import type { LanguageDocument } from "../../language/protocol";
import type { EditorSettings } from "../../settings/editorSettings";
import { lexicalBrackets } from "../core/actions";
import type { EditorSession } from "../core/editor";
import { multiEdit } from "../core/multiEdit";
import { findMatches } from "../core/search";
import type { Selection } from "../core/selection";
import {
	FoldProjection,
	type FoldRange,
	rebaseFolds,
	sourceDifference,
} from "./folding";

export interface EditorControl {
	selectNext(): void;
	selectAll(): void;
	clearCursors(): void;
	fold(): void;
	unfold(): void;
}

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
	language?: LanguageDocument;
	revision: number;
	settings: EditorSettings;
	readOnly: boolean;
	onChange: () => void;
	onSelectionChange: () => void;
	revealRequest: number;
	focusRequest: number;
	onReady: (control: EditorControl | undefined) => void;
}) {
	let input!: HTMLTextAreaElement;
	let restoredScroll = false;
	let renderedVersion = -1;
	let lastRevealRequest = props.revealRequest;
	let allowTabExit = false;
	let keepExtraVersion = -1;
	let pointerSelection: Selection | undefined;
	let lastSource = props.session.snapshot.text;
	const [folds, setFolds] = createSignal<FoldRange[]>([]);
	const projection = createMemo(() => {
		props.revision;
		return new FoldProjection(props.session.snapshot.text, folds());
	});
	const syntaxTokens = createMemo(() =>
		props.language?.text === props.session.snapshot.text
			? props.language.tokens.map((token) => ({
					...token,
					from: projection().toView(token.from),
					to: projection().toView(token.to),
				}))
			: [],
	);
	const sourceLines = createMemo(() => {
		props.revision;
		return folds().length
			? new LineIndex(props.session.snapshot.text)
			: undefined;
	});
	const [extraSelections, setExtraSelections] = createSignal<Selection[]>([]);
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
	let indexed = new LineIndex(renderText());
	const lines = createMemo(() => {
		const text = renderText();
		const edit = inputEdit(indexed.text, text);
		if (edit) indexed = indexed.update(text, edit);
		return { index: indexed, text };
	});
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
			lines().index.count,
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
		if (!composing() && input.value === projection().text) {
			const next = {
				anchor: projection().toDocument(current.anchor),
				head: projection().toDocument(current.head),
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
	const commit = (group?: string, distributePaste = false) => {
		const before = props.session.snapshot.text;
		if (folds().length) {
			const view = projection();
			const change = inputEdit(view.text, input.value);
			if (!change) {
				syncSelection();
				return;
			}
			const from = view.toDocument(change.from, "left");
			const to =
				change.from === change.to
					? from
					: view.toDocument(change.to, "right");
			const ending = before.includes("\r\n")
				? "\r\n"
				: before.includes("\r")
					? "\r"
					: "\n";
			const edit = { from, to, text: change.text.replace(/\n/g, ending) };
			const next = before.slice(0, from) + edit.text + before.slice(to);
			const nextView = new FoldProjection(
				next,
				rebaseFolds(folds(), edit),
			);
			const current = selection();
			const marker =
				view.foldAt(change.from) ||
				view.foldAt(Math.max(change.from, change.to - 1));
			const after = marker
				? {
						anchor: from + edit.text.length,
						head: from + edit.text.length,
					}
				: {
						anchor: nextView.toDocument(current.anchor),
						head: nextView.toDocument(current.head),
					};
			props.session.apply({ edit, selectionAfter: after, group });
			props.onChange();
			return;
		}
		let edit = inputEdit(before, input.value);
		if (!edit) {
			setRenderText(input.value);
			syncSelection();
			return;
		}
		if (extraSelections().length) {
			const primary = props.session.selection;
			const start = displayOffset(
				before,
				Math.min(primary.anchor, primary.head),
			);
			const end = displayOffset(
				before,
				Math.max(primary.anchor, primary.head),
			);
			const delta = input.value.length - displayText(before).length;
			let from = start,
				to = end;
			if (start === end && delta < 0) {
				if (input.selectionStart < start) from = start + delta;
				else to = start - delta;
			}
			const insertedLength =
				input.value.length - (displayText(before).length - (to - from));
			const ending = before.includes("\r\n")
				? "\r\n"
				: before.includes("\r")
					? "\r"
					: "\n";
			edit = {
				from: documentOffset(before, from),
				to: documentOffset(before, to),
				text: input.value
					.slice(from, from + insertedLength)
					.replace(/\n/g, ending),
			};
			const result = multiEdit(
				before,
				props.session.selection,
				extraSelections(),
				edit,
				distributePaste,
			);
			props.session.apply({
				edit: result.edit,
				selectionAfter: result.primary,
			});
			keepExtraVersion = props.session.snapshot.version;
			setExtraSelections(result.secondary);
			props.onChange();
			return;
		}
		const next =
			before.slice(0, edit.from) + edit.text + before.slice(edit.to);
		const current = selection();
		props.session.apply({
			group,
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
		if (props.settings.wordWrap) {
			const probe = document.createElement("div");
			probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;pointer-events:none;width:${Math.max(1, input.clientWidth - editorPadding * 2)}px`;
			const node = document.createTextNode(input.value || "\u200b");
			probe.append(node);
			input.parentElement?.append(probe);
			const range = document.createRange();
			range.setStart(node, Math.min(selection().head, node.length));
			range.collapse(true);
			const rect = range.getBoundingClientRect(),
				box = probe.getBoundingClientRect();
			const top = editorPadding + rect.top - box.top;
			probe.remove();
			if (top < input.scrollTop)
				input.scrollTop = Math.max(0, top - editorPadding);
			else if (top + lineHeight() > input.scrollTop + input.clientHeight)
				input.scrollTop =
					top + lineHeight() - input.clientHeight + editorPadding;
			savePosition();
			return;
		}
		const line = lines().index.lineAt(selection().head);
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
			lines().index.starts[line],
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
			() => [props.session, props.revision, props.revealRequest, folds()],
			() => {
				if (composing()) return;
				const text = props.session.snapshot.text;
				const version = props.session.snapshot.version;
				const edited =
					renderedVersion !== -1 && renderedVersion !== version;
				renderedVersion = version;
				let ranges = folds();
				if (edited) {
					const difference = sourceDifference(lastSource, text);
					if (difference) {
						ranges = rebaseFolds(ranges, difference);
						setFolds(ranges);
					}
				}
				lastSource = text;
				if (lastRevealRequest !== props.revealRequest) {
					ranges = ranges.filter(
						(range) =>
							!(
								props.session.selection.head >= range.from &&
								props.session.selection.head < range.to
							),
					);
					if (ranges.length !== folds().length) setFolds(ranges);
				}
				if (edited && version !== keepExtraVersion)
					setExtraSelections([]);
				const projected = new FoldProjection(text, ranges);
				const normalized = projected.text;
				if (input.value !== normalized) input.value = normalized;
				setRenderText(normalized);
				const { anchor, head } = props.session.selection;
				input.setSelectionRange(
					projected.toView(Math.min(anchor, head)),
					projected.toView(Math.max(anchor, head)),
					head < anchor ? "backward" : "forward",
				);
				setSelected(selection());
				const saved = scrollPositions.get(props.session);
				if (saved && !restoredScroll) {
					input.scrollTop = saved.top;
					input.scrollLeft = saved.left;
				}
				restoredScroll = true;
				if (
					edited ||
					(props.revealRequest > 0 &&
						lastRevealRequest !== props.revealRequest)
				)
					revealSelection();
				lastRevealRequest = props.revealRequest;
				savePosition();
			},
		),
	);
	onMount(() => {
		const chooseOccurrences = (all: boolean) => {
			if (props.settings.wordWrap || folds().length)
				throw new Error(
					"Turn off wrapping before adding multiple cursors.",
				);
			const text = props.session.snapshot.text;
			let current = props.session.selection;
			if (current.anchor === current.head) {
				let from = current.head,
					to = current.head;
				while (from > 0 && /[\p{L}\p{N}_$]/u.test(text[from - 1]))
					from--;
				while (to < text.length && /[\p{L}\p{N}_$]/u.test(text[to]))
					to++;
				if (from === to) return;
				current = { anchor: from, head: to };
				props.session.setSelection(current);
			}
			const query = text.slice(
				Math.min(current.anchor, current.head),
				Math.max(current.anchor, current.head),
			);
			const matches = findMatches(text, query, {
				matchCase: true,
				wholeWord: false,
			});
			const existing = [current, ...extraSelections()];
			const available = matches.filter(
				(match) =>
					!existing.some(
						(selection) =>
							Math.min(selection.anchor, selection.head) ===
								match.from &&
							Math.max(selection.anchor, selection.head) ===
								match.to,
					),
			);
			const next =
				available.find(
					(match) =>
						match.from >= Math.max(current.anchor, current.head),
				) ?? available[0];
			setExtraSelections(
				all
					? matches
							.filter(
								(match) =>
									match.from !==
									Math.min(current.anchor, current.head),
							)
							.slice(0, 999)
							.map((match) => ({
								anchor: match.from,
								head: match.to,
							}))
					: next
						? [
								...extraSelections(),
								{ anchor: next.from, head: next.to },
							]
						: extraSelections(),
			);
			props.onChange();
			input.focus({ preventScroll: true });
		};
		props.onReady({
			selectNext: () => chooseOccurrences(false),
			selectAll: () => chooseOccurrences(true),
			clearCursors: () => setExtraSelections([]),
			unfold: () => setFolds([]),
			fold: () => {
				const text = props.session.snapshot.text;
				const source = new LineIndex(text);
				const selection = props.session.selection;
				let first = source.lineAt(
						Math.min(selection.anchor, selection.head),
					),
					last = source.lineAt(
						Math.max(selection.anchor, selection.head),
					);
				if (first === last) {
					const candidates = [...lexicalBrackets(text)]
						.filter(
							([from, to]) =>
								from < to &&
								source.lineAt(from) <= first &&
								source.lineAt(to) > first,
						)
						.sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
					const pair = candidates[0];
					if (!pair) return;
					first = source.lineAt(pair[0]);
					last = source.lineAt(pair[1]);
				}
				const from = source.starts[first + 1],
					to = source.starts[last];
				if (from === undefined || to <= from) return;
				setExtraSelections([]);
				props.session.setSelection({
					anchor: source.ends[first],
					head: source.ends[first],
				});
				setFolds((previous) => [
					...previous.filter(
						(range) => range.to <= from || range.from >= to,
					),
					{ from, to },
				]);
				props.onSelectionChange();
			},
		});
		const observer = new ResizeObserver(measure);
		observer.observe(input);
		measure();
		let disposed = false;
		void document.fonts.ready.then(() => {
			if (!disposed) measure();
		});
		onCleanup(() => {
			props.onReady(undefined);
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
			() => props.settings.wordWrap,
			() => {
				setExtraSelections([]);
				measure();
			},
		),
	);
	createEffect(
		on(
			() => props.focusRequest,
			(value) => {
				if (value > 0) input.focus({ preventScroll: true });
			},
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
			<Show when={props.settings.lineNumbers && !props.settings.wordWrap}>
				<div
					class="virtual-gutter"
					aria-hidden="true"
					style={{
						width: `${lines().index.count.toString().length + 2}ch`,
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
								{sourceLines()
									? (sourceLines()?.lineAt(
											projection().toDocument(
												lines().index.starts[number],
											),
										) ?? number) + 1
									: number + 1}
							</div>
						)}
					</For>
				</div>
			</Show>
			<div class="editor-stage">
				<span id={helpId} class="editor-accessibility-help">
					Press Escape and Tab to move focus out of the editor.
					{folds().length
						? " Some source is folded. Use Unfold all blocks in the command palette to reveal it."
						: ""}
				</span>
				<span class="editor-accessibility-help" role="status">
					{extraSelections().length
						? `${extraSelections().length + 1} cursors`
						: ""}
				</span>
				<Show when={!props.settings.wordWrap}>
					<Viewport
						tokens={syntaxTokens()}
						lines={lines().index}
						selection={selected()}
						secondary={extraSelections().map((selection) => ({
							anchor: displayOffset(
								props.session.snapshot.text,
								selection.anchor,
							),
							head: displayOffset(
								props.session.snapshot.text,
								selection.head,
							),
						}))}
						scrollTop={scroll().top}
						scrollLeft={scroll().left}
						height={size().height}
						width={size().width}
						lineHeight={lineHeight()}
						focused={focused()}
						composing={composing()}
					/>
				</Show>
				<textarea
					ref={input}
					class="editor-input"
					classList={{
						composing: composing() || props.settings.wordWrap,
					}}
					aria-label="File contents"
					aria-describedby={helpId}
					readOnly={props.readOnly}
					spellcheck={false}
					autocapitalize="off"
					autocomplete="off"
					wrap={props.settings.wordWrap ? "soft" : "off"}
					style={{
						"white-space": props.settings.wordWrap
							? "pre-wrap"
							: "pre",
					}}
					onFocus={() => {
						setFocused(true);
						syncSelection();
					}}
					onBlur={() => {
						props.session.breakUndoGroup();
						setFocused(false);
						syncSelection();
					}}
					onScroll={savePosition}
					onSelect={syncSelection}
					onDblClick={() => {
						const fold = projection().foldAt(input.selectionStart);
						if (fold)
							setFolds((previous) =>
								previous.filter(
									(range) => range.from !== fold.from,
								),
							);
					}}
					onCopy={(event) => {
						if (
							!(folds().length || extraSelections().length) ||
							!event.clipboardData
						)
							return;
						syncSelection();
						const selections = [
							props.session.selection,
							...extraSelections(),
						].sort(
							(a, b) =>
								Math.min(a.anchor, a.head) -
								Math.min(b.anchor, b.head),
						);
						if (
							!selections.some(
								(selection) =>
									selection.anchor !== selection.head,
							)
						)
							return;
						event.preventDefault();
						const source = props.session.snapshot.text;
						event.clipboardData.setData(
							"text/plain",
							selections
								.map((selection) =>
									source.slice(
										Math.min(
											selection.anchor,
											selection.head,
										),
										Math.max(
											selection.anchor,
											selection.head,
										),
									),
								)
								.join(source.includes("\r\n") ? "\r\n" : "\n"),
						);
					}}
					onCut={(event) => {
						if (
							!(folds().length || extraSelections().length) ||
							!event.clipboardData
						)
							return;
						syncSelection();
						const primary = props.session.selection;
						const selections = [primary, ...extraSelections()].sort(
							(a, b) =>
								Math.min(a.anchor, a.head) -
								Math.min(b.anchor, b.head),
						);
						if (
							!selections.some(
								(selection) =>
									selection.anchor !== selection.head,
							)
						)
							return;
						event.preventDefault();
						const source = props.session.snapshot.text;
						event.clipboardData.setData(
							"text/plain",
							selections
								.map((selection) =>
									source.slice(
										Math.min(
											selection.anchor,
											selection.head,
										),
										Math.max(
											selection.anchor,
											selection.head,
										),
									),
								)
								.join(source.includes("\r\n") ? "\r\n" : "\n"),
						);
						if (props.readOnly) return;
						const edit = {
							from: Math.min(primary.anchor, primary.head),
							to: Math.max(primary.anchor, primary.head),
							text: "",
						};
						if (extraSelections().length) {
							const result = multiEdit(
								source,
								primary,
								extraSelections(),
								edit,
							);
							props.session.apply({
								edit: result.edit,
								selectionAfter: result.primary,
							});
							setExtraSelections(result.secondary);
							keepExtraVersion = props.session.snapshot.version;
						} else props.session.apply({ edit });
						props.onChange();
					}}
					onKeyUp={syncSelection}
					onPointerUp={(event) => {
						syncSelection();
						if (
							event.altKey &&
							pointerSelection &&
							!folds().length &&
							!props.settings.wordWrap
						)
							setExtraSelections((previous) => [
								...previous,
								pointerSelection as Selection,
							]);
					}}
					onPointerDown={(event) => {
						props.session.breakUndoGroup();
						pointerSelection = { ...props.session.selection };
						if (!event.altKey) setExtraSelections([]);
					}}
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
					onInput={(event) => {
						if (composing()) {
							setRenderText(input.value);
							setSelected(selection());
						} else
							commit(
								event.inputType === "insertText"
									? "typing"
									: event.inputType ===
											"deleteContentBackward"
										? "backspace"
										: event.inputType ===
												"deleteContentForward"
											? "delete"
											: undefined,
								event.inputType === "insertFromPaste",
							);
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
						if (
							event.key.startsWith("Arrow") ||
							[
								"Home",
								"End",
								"PageUp",
								"PageDown",
								"Escape",
								"Tab",
								"Enter",
							].includes(event.key)
						)
							props.session.breakUndoGroup();
						if (props.readOnly || event.isComposing || composing())
							return;
						if (event.key === "Escape") {
							setExtraSelections([]);
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
							event.key.startsWith("Arrow") ||
							["Home", "End", "PageUp", "PageDown"].includes(
								event.key,
							)
						)
							setExtraSelections([]);
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
