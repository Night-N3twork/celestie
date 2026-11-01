import {
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
} from "solid-js";
import {
	findMatches,
	nextMatch,
	type SearchMatch,
} from "../editor/core/search";
import { type FolderMatch, searchFolders } from "../workspace/search";
import type { WorkbenchController } from "./createWorkbenchController";

export interface SearchControl {
	next(backwards: boolean): void;
	hasQuery(): boolean;
}
export function createSearchModel(c: WorkbenchController) {
	const [query, setQuery] = createSignal("");
	const [replacement, setReplacement] = createSignal("");
	const [matchCase, setMatchCase] = createSignal(false);
	const [wholeWord, setWholeWord] = createSignal(false);
	const [exclusions, setExclusions] = createSignal(
		"**/node_modules/**, **/.git/**, **/dist/**, **/dist-electron/**",
	);
	const [folderResults, setFolderResults] = createSignal<FolderMatch[]>([]);
	const [searching, setSearching] = createSignal(false);
	const [applying, setApplying] = createSignal(false);
	const [preview, setPreview] = createSignal(false);
	const [message, setMessage] = createSignal("");
	let abort: AbortController | undefined,
		timer: ReturnType<typeof setTimeout> | undefined;
	const roots = createMemo(() =>
		c
			.folders()
			.filter((root) => root.accessible)
			.map((root) => root.entry),
	);
	const rootKey = createMemo(() =>
		roots()
			.map((root) => root.id)
			.join("\0"),
	);
	const bufferStamp = createMemo(() => {
		c.revision();
		return c
			.documents()
			.filter((doc) => doc.dirty)
			.map((doc) => `${doc.id}:${doc.editor.snapshot.version}`)
			.join("\0");
	});
	const currentFile = createMemo(() => c.file());
	const currentText = createMemo(() => {
		c.revision();
		return currentFile()?.editor.snapshot.text ?? "";
	});
	const options = () => ({ matchCase: matchCase(), wholeWord: wholeWord() });
	const currentResults = createMemo<FolderMatch[]>(() => {
		const doc = currentFile();
		if (!doc || !query()) return [];
		const text = currentText(),
			matches = findMatches(text, query(), options());
		return matches.length
			? [
					{
						entry: { id: doc.id, name: doc.name, kind: "file" },
						path: doc.name,
						text,
						matches,
					},
				]
			: [];
	});
	const results = () =>
		c.searchCurrentFile() ? currentResults() : folderResults();
	const choices = createMemo(() =>
		results().flatMap((result) =>
			result.matches.map((match) => ({ result, match })),
		),
	);
	const selectedIndex = () => {
		c.selectionRevision();
		c.revision();
		const doc = c.file();
		if (!doc) return -1;
		const { anchor, head } = doc.editor.selection;
		return choices().findIndex(
			({ result, match }) =>
				result.entry.id === doc.id &&
				match.from === Math.min(anchor, head) &&
				match.to === Math.max(anchor, head),
		);
	};
	const selectCurrent = (match: SearchMatch | undefined, focus = false) => {
		const doc = c.file();
		if (!doc || !match || c.busy()) return;
		doc.editor.setSelection({ anchor: match.from, head: match.to });
		c.setRevealRequest((value) => value + 1);
		c.setSelectionRevision((value) => value + 1);
		c.changed();
		if (focus) c.setEditorFocus((value) => value + 1);
	};
	const choose = async (index: number, focus = true) => {
		const choice = choices()[index];
		if (!choice) return;
		try {
			if (c.searchCurrentFile()) selectCurrent(choice.match, focus);
			else await c.openSearchResult(choice.result, choice.match);
		} catch (error) {
			setMessage(String(error));
		}
	};
	const next = (backwards: boolean) => {
		const count = choices().length;
		if (!count || applying()) return;
		const index = selectedIndex();
		if (c.searchCurrentFile() && index < 0) {
			selectCurrent(
				nextMatch(
					currentResults()[0]?.matches ?? [],
					c.file()?.editor.selection.head ?? 0,
					backwards,
					true,
				),
			);
			return;
		}
		void choose(
			index < 0
				? backwards
					? count - 1
					: 0
				: (index + (backwards ? -1 : 1) + count) % count,
			false,
		);
	};
	const search = async () => {
		clearTimeout(timer);
		abort?.abort();
		if (c.searchCurrentFile() || !query() || !roots().length || applying())
			return;
		const current = new AbortController();
		abort = current;
		setSearching(true);
		setPreview(false);
		setFolderResults([]);
		setMessage("");
		try {
			const buffers = new Map(
				c.documents().map((doc) => [doc.id, doc.editor.snapshot.text]),
			);
			const summary = await searchFolders(
				c.host,
				roots(),
				query(),
				options(),
				exclusions(),
				buffers,
				current.signal,
				(result) => {
					if (!current.signal.aborted)
						setFolderResults((previous) => [...previous, result]);
				},
			);
			if (!current.signal.aborted && summary.limited)
				setMessage("Result limit reached. Narrow your search.");
		} catch (error) {
			if (abort === current)
				setMessage(
					current.signal.aborted
						? "Search cancelled. Results may be incomplete."
						: String(error),
				);
		} finally {
			if (abort === current) setSearching(false);
		}
	};
	createEffect(
		on(
			[
				query,
				matchCase,
				wholeWord,
				exclusions,
				rootKey,
				bufferStamp,
				c.searchCurrentFile,
				c.workspaceSearchOpen,
			],
			() => {
				if (applying()) return;
				clearTimeout(timer);
				abort?.abort();
				setSearching(false);
				setPreview(false);
				setMessage("");
				setFolderResults([]);
				if (
					c.workspaceSearchOpen() &&
					!c.searchCurrentFile() &&
					query() &&
					roots().length
				)
					timer = setTimeout(() => void search(), 250);
			},
		),
	);
	createEffect(
		on(
			[query, matchCase, wholeWord, currentFile, c.searchCurrentFile],
			() => {
				if (
					!c.searchCurrentFile() ||
					!query() ||
					!c.workspaceSearchOpen() ||
					!c.sidebarOpen()
				)
					return;
				const doc = c.file();
				if (doc)
					selectCurrent(
						nextMatch(
							currentResults()[0]?.matches ?? [],
							Math.min(
								doc.editor.selection.anchor,
								doc.editor.selection.head,
							),
						),
					);
			},
		),
	);
	const replaceOne = async () => {
		if (!c.searchCurrentFile() || applying() || c.busy()) return;
		const index = selectedIndex(),
			choice = choices()[index >= 0 ? index : 0];
		if (!choice) return;
		try {
			await c.applySearchResult(
				{ ...choice.result, matches: [choice.match] },
				replacement(),
			);
			const following = nextMatch(
				currentResults()[0]?.matches ?? [],
				choice.match.from + replacement().length,
			);
			selectCurrent(following);
			setMessage("Replaced 1 match.");
		} catch (error) {
			setMessage(String(error));
		}
	};
	const replaceAll = async () => {
		if (c.busy() || applying() || searching()) return;
		if (!c.searchCurrentFile() && !preview()) {
			setPreview(true);
			return;
		}
		const snapshot = results(),
			count = snapshot.reduce(
				(sum, result) => sum + result.matches.length,
				0,
			),
			value = replacement();
		const current = new AbortController();
		abort = current;
		setApplying(true);
		let changed = 0;
		try {
			for (const result of snapshot) {
				current.signal.throwIfAborted();
				await c.applySearchResult(result, value);
				changed++;
			}
			setPreview(false);
			setFolderResults([]);
			setMessage(
				`Replaced ${count} matches in ${changed} ${changed === 1 ? "file" : "files"}. Changes are unsaved.`,
			);
		} catch (error) {
			setPreview(false);
			setFolderResults([]);
			setMessage(`${changed} files updated; ${String(error)}`);
		} finally {
			setApplying(false);
		}
	};
	const review = (result: FolderMatch) => {
		let after = result.text;
		for (const match of [...result.matches].reverse())
			after =
				after.slice(0, match.from) +
				replacement() +
				after.slice(match.to);
		c.diffs.open({
			id: `search:${result.entry.id}`,
			fileId: result.entry.id,
			path: result.path,
			before: result.text,
			after,
			beforeLabel: "Original",
			afterLabel: "Replacement preview",
			canOpen: true,
		});
	};
	const control: SearchControl = { next, hasQuery: () => !!query() };
	c.setSearchControl(control);
	onCleanup(() => {
		clearTimeout(timer);
		abort?.abort();
		c.setSearchControl(undefined);
	});
	return {
		query,
		setQuery,
		replacement,
		setReplacement: (value: string) => {
			setReplacement(value);
			setPreview(false);
		},
		matchCase,
		setMatchCase,
		wholeWord,
		setWholeWord,
		exclusions,
		setExclusions,
		results,
		choices,
		selectedIndex,
		searching,
		applying,
		preview,
		message,
		next,
		choose,
		search,
		replaceOne,
		replaceAll,
		review,
		cancel: () => abort?.abort(),
		roots,
	};
}
