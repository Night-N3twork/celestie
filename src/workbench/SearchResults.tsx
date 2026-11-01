import { For, Show } from "solid-js";
import type { SearchMatch } from "../editor/core/search";
import { LineIndex } from "../editor/view/lineIndex";
import FileIcon from "../icons/files/file.svg";
import DiffIcon from "../icons/git/diff.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import type { FolderMatch } from "../workspace/search";
import ActionButton from "./ActionButton";
import type { createSearchModel } from "./createSearchModel";

function groupLines(result: FolderMatch) {
	const index = new LineIndex(result.text),
		groups = new Map<number, SearchMatch[]>();
	for (const match of result.matches) {
		const line = index.lineAt(match.from),
			matches = groups.get(line) ?? [];
		matches.push(match);
		groups.set(line, matches);
	}
	return [...groups].slice(0, 200).map(([line, matches]) => {
		const content = index.line(line),
			start = matches[0].from - index.starts[line];
		let cursor = Math.max(0, start - 32);
		const pieces: { text: string; matched: boolean }[] = cursor
			? [{ text: "…", matched: false }]
			: [];
		for (const match of matches.slice(0, 100)) {
			const from = match.from - index.starts[line],
				to = Math.min(content.length, match.to - index.starts[line]);
			pieces.push(
				{ text: content.slice(cursor, from), matched: false },
				{ text: content.slice(from, to), matched: true },
			);
			cursor = to;
		}
		pieces.push({
			text: content.slice(cursor, cursor + 100),
			matched: false,
		});
		return { line, start, matches, pieces };
	});
}

export default function SearchResults(props: {
	search: ReturnType<typeof createSearchModel>;
}) {
	const search = props.search,
		cache = new WeakMap<FolderMatch, ReturnType<typeof groupLines>>();
	const rowsFor = (result: FolderMatch) => {
		let rows = cache.get(result);
		if (!rows) {
			rows = groupLines(result);
			cache.set(result, rows);
		}
		return rows;
	};
	return (
		<section class="search-results" aria-label="Search results">
			<For each={search.results()}>
				{(result) => (
					<details class="search-file" open>
						<summary>
							<ChevronIcon
								class="search-file-chevron"
								size={14}
								nobox
								aria-hidden="true"
							/>
							<FileIcon size={18} nobox aria-hidden="true" />
							<span title={result.path}>{result.path}</span>
							<span class="search-count">
								{result.matches.length}
							</span>
						</summary>
						<Show when={search.preview()}>
							<ActionButton
								label={`Review replacements in ${result.path}`}
								icon={DiffIcon}
								onClick={() => search.review(result)}
							/>
						</Show>
						<For each={rowsFor(result)}>
							{(row) => {
								const choiceIndex = () =>
									search
										.choices()
										.findIndex(
											(choice) =>
												choice.result === result &&
												choice.match === row.matches[0],
										);
								const selected = () => {
									const choice =
										search.choices()[
											search.selectedIndex()
										];
									return (
										choice?.result === result &&
										row.matches.includes(choice.match)
									);
								};
								return (
									<button
										type="button"
										class="search-result"
										aria-label={`${result.path}:${row.line + 1}:${row.start + 1}`}
										aria-current={selected()}
										disabled={search.applying()}
										onClick={() =>
											void search.choose(choiceIndex())
										}
									>
										<span class="search-line-number">
											{row.line + 1}
										</span>
										<span class="search-result-text">
											<For each={row.pieces}>
												{(piece) =>
													piece.matched ? (
														<mark>
															{piece.text}
														</mark>
													) : (
														<span>
															{piece.text}
														</span>
													)
												}
											</For>
										</span>
									</button>
								);
							}}
						</For>
						<Show when={rowsFor(result).length === 200}>
							<p class="search-limit">
								Showing the first 200 matching lines.
							</p>
						</Show>
					</details>
				)}
			</For>
		</section>
	);
}
