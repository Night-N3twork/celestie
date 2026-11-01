import {
	createEffect,
	createMemo,
	createSignal,
	on,
	onMount,
	Show,
} from "solid-js";
import type { EditorSession } from "../editor/core/editor";
import {
	findMatches,
	nextMatch,
	replaceMatches,
	type SearchMatch,
} from "../editor/core/search";
import { selectionRange } from "../editor/core/selection";
import CloseIcon from "../icons/actions/close.svg";

export interface FindReplaceControl {
	next(backwards: boolean): void;
	hasQuery(): boolean;
}

export default function FindReplace(props: {
	session: EditorSession | undefined;
	revision: number;
	selectionRevision: number;
	visible: boolean;
	showReplace: boolean;
	focusRequest: number;
	disabled: boolean;
	onUpdate: () => void;
	onClose: () => void;
	onReady: (control: FindReplaceControl) => void;
}) {
	let findInput!: HTMLInputElement;
	let replaceInput!: HTMLInputElement;
	const [query, setQuery] = createSignal("");
	const [replacement, setReplacement] = createSignal("");
	const [matchCase, setMatchCase] = createSignal(false);
	const [wholeWord, setWholeWord] = createSignal(false);
	const [report, setReport] = createSignal("");
	const activeSession = createMemo(() => props.session);
	const text = createMemo(() => {
		props.revision;
		return props.session?.snapshot.text ?? "";
	});
	const matches = createMemo(() =>
		findMatches(text(), query(), {
			matchCase: matchCase(),
			wholeWord: wholeWord(),
		}),
	);
	const selectedMatch = () => {
		props.revision;
		props.selectionRevision;
		if (!props.session) return;
		const selected = selectionRange(props.session.selection);
		return matches().find(
			(match) => match.from === selected.from && match.to === selected.to,
		);
	};
	const select = (match: SearchMatch | undefined) => {
		if (!match || !props.session || props.disabled) return;
		props.session.setSelection({ anchor: match.from, head: match.to });
		props.onUpdate();
	};
	const next = (backwards: boolean) => {
		if (!props.session || props.disabled) return;
		const current = selectedMatch();
		const offset = current ? current.from : props.session.selection.head;
		select(nextMatch(matches(), offset, backwards, !current));
		setReport("");
	};
	const replaceOne = () => {
		const session = props.session;
		if (!session || props.disabled) return;
		const match =
			selectedMatch() ?? nextMatch(matches(), session.selection.head);
		if (!match) return;
		const value = replacement();
		if (session.snapshot.text.slice(match.from, match.to) !== value)
			session.apply({ edit: { ...match, text: value } });
		const updated = findMatches(session.snapshot.text, query(), {
			matchCase: matchCase(),
			wholeWord: wholeWord(),
		});
		const following = nextMatch(updated, match.from + value.length);
		if (following)
			session.setSelection({
				anchor: following.from,
				head: following.to,
			});
		props.onUpdate();
		setReport("Replaced 1 occurrence.");
	};
	const replaceAll = () => {
		const session = props.session;
		if (!session || props.disabled) return;
		const count = matches().length;
		const edit = replaceMatches(
			session.snapshot.text,
			matches(),
			replacement(),
		);
		if (!edit) return;
		if (session.snapshot.text.slice(edit.from, edit.to) !== edit.text)
			session.apply({
				edit,
				selectionAfter: {
					anchor: edit.from,
					head: edit.from + replacement().length,
				},
			});
		props.onUpdate();
		setReport(`Replaced ${count} occurrence${count === 1 ? "" : "s"}.`);
	};
	createEffect(
		on(
			() => [query(), matchCase(), wholeWord(), activeSession()],
			() => {
				setReport("");
				if (props.visible && props.session)
					select(
						nextMatch(
							matches(),
							Math.min(
								props.session.selection.anchor,
								props.session.selection.head,
							),
						),
					);
			},
		),
	);
	createEffect(
		on(
			() => props.focusRequest,
			() => {
				if (!props.visible) return;
				const session = props.session;
				if (session) {
					const range = selectionRange(session.selection);
					const value = session.snapshot.text.slice(
						range.from,
						range.to,
					);
					if (value && !/[\r\n]/.test(value)) setQuery(value);
				}
				findInput.focus();
				findInput.select();
				if (session && query())
					select(
						nextMatch(
							matches(),
							Math.min(
								session.selection.anchor,
								session.selection.head,
							),
						),
					);
			},
		),
	);
	onMount(() => props.onReady({ next, hasQuery: () => !!query() }));
	const countMessage = () => {
		if (!query()) return "Enter text to find.";
		const match = selectedMatch();
		if (!matches().length) return "No matches.";
		return match
			? `${matches().indexOf(match) + 1} of ${matches().length} matches`
			: `${matches().length} matches`;
	};
	return (
		<Show when={props.visible}>
			<form
				aria-label="Find and replace"
				onSubmit={(event) => {
					event.preventDefault();
					next(false);
				}}
				onKeyDown={(event) => {
					if (event.isComposing) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					}
					if (
						event.key === "Enter" &&
						event.target instanceof HTMLInputElement
					) {
						event.preventDefault();
						if (event.target === replaceInput && !event.shiftKey)
							replaceOne();
						else next(event.shiftKey);
					}
				}}
			>
				<label>
					Find{" "}
					<input
						ref={findInput}
						type="text"
						value={query()}
						onInput={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<button
					type="button"
					disabled={
						props.disabled || !matches().length || !props.session
					}
					onClick={() => next(true)}
				>
					Previous match
				</button>
				<button
					type="button"
					disabled={
						props.disabled || !matches().length || !props.session
					}
					onClick={() => next(false)}
				>
					Next match
				</button>
				<label>
					<input
						type="checkbox"
						checked={matchCase()}
						onChange={(event) =>
							setMatchCase(event.currentTarget.checked)
						}
					/>{" "}
					Match case
				</label>
				<label>
					<input
						type="checkbox"
						checked={wholeWord()}
						onChange={(event) =>
							setWholeWord(event.currentTarget.checked)
						}
					/>{" "}
					Whole word
				</label>
				<Show when={props.showReplace}>
					<label>
						Replace with{" "}
						<input
							ref={replaceInput}
							type="text"
							value={replacement()}
							onInput={(event) =>
								setReplacement(event.currentTarget.value)
							}
						/>
					</label>
					<button
						type="button"
						disabled={
							props.disabled ||
							!matches().length ||
							!props.session
						}
						onClick={replaceOne}
					>
						Replace
					</button>
					<button
						type="button"
						disabled={
							props.disabled ||
							!matches().length ||
							!props.session
						}
						onClick={replaceAll}
					>
						Replace all
					</button>
				</Show>
				<button
					type="button"
					aria-label="Close find and replace"
					onClick={props.onClose}
				>
					<CloseIcon size={18} nobox aria-hidden="true" />
				</button>
				<output aria-live="polite">
					{countMessage()}
					{report() ? ` ${report()}` : ""}
				</output>
			</form>
		</Show>
	);
}
