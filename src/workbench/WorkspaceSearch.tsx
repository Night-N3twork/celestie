import { createEffect, createSignal, on, Show } from "solid-js";
import MoreIcon from "../icons/actions/more.svg";
import StopIcon from "../icons/debug/stop.svg";
import FileIcon from "../icons/files/file.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import SearchIcon from "../icons/panels/search.svg";
import ActionButton from "./ActionButton";
import { createSearchModel } from "./createSearchModel";
import type { WorkbenchController } from "./createWorkbenchController";
import SearchResults from "./SearchResults";
import ToolWindowHeader from "./ToolWindowHeader";

export default function WorkspaceSearch(props: {
	controller: WorkbenchController;
}) {
	const c = props.controller,
		search = createSearchModel(c);
	let input!: HTMLInputElement;
	const [filters, setFilters] = createSignal(false);
	const visible = () => c.workspaceSearchOpen() && c.sidebarOpen();
	const close = () => {
		search.cancel();
		c.setWorkspaceSearchOpen(false);
		c.setSidebarOpen(false);
		c.setEditorFocus((value) => value + 1);
	};
	createEffect(
		on(c.workspaceSearchFocus, () =>
			queueMicrotask(() => {
				if (!visible()) return;
				const doc = c.file();
				if (c.searchCurrentFile() && doc) {
					const { anchor, head } = doc.editor.selection;
					const selected = doc.editor.snapshot.text.slice(
						Math.min(anchor, head),
						Math.max(anchor, head),
					);
					if (selected && !/[\r\n]/.test(selected))
						search.setQuery(selected);
				}
				input.focus();
				input.select();
			}),
		),
	);
	const summary = () => {
		if (search.applying()) return "Applying replacements…";
		if (search.searching()) return "Searching…";
		if (search.message()) return search.message();
		if (c.searchCurrentFile() && !c.file())
			return "Open a file to search its contents.";
		if (!c.searchCurrentFile() && !search.roots().length)
			return "Open a folder to search your workspace.";
		if (!search.query())
			return c.searchCurrentFile()
				? "Search the current file."
				: "Search your workspace.";
		const total = search.choices().length,
			index = search.selectedIndex();
		return c.searchCurrentFile()
			? total
				? `${index < 0 ? total : `${index + 1} of ${total}`} matches`
				: "No matches."
			: `${total} results in ${search.results().length} files`;
	};
	return (
		<aside
			class="file-explorer search-sidebar"
			aria-label="Search sidebar"
			hidden={!visible()}
			onKeyDown={(event) => {
				if (!event.isComposing && event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					close();
				}
			}}
		>
			<ToolWindowHeader title="Search" onHide={close} />
			<div class="search-controls">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void search.search();
					}}
				>
					<div class="search-input-row">
						<button
							type="button"
							class="icon-button"
							aria-label="Show replacement"
							aria-pressed={c.replaceOpen()}
							title="Show replacement"
							onClick={() => c.setReplaceOpen((value) => !value)}
						>
							<ChevronIcon
								size={18}
								nobox
								aria-hidden="true"
								style={{
									transform: c.replaceOpen()
										? "rotate(90deg)"
										: undefined,
								}}
							/>
						</button>
						<input
							ref={input}
							aria-label="Search text"
							placeholder="Search"
							value={search.query()}
							disabled={search.applying()}
							onInput={(event) =>
								search.setQuery(event.currentTarget.value)
							}
							onKeyDown={(event) => {
								if (event.key !== "Enter" || event.isComposing)
									return;
								event.preventDefault();
								if (
									c.searchCurrentFile() ||
									search.choices().length
								)
									search.next(event.shiftKey);
								else void search.search();
							}}
						/>
						<ActionButton
							label={
								search.searching()
									? "Cancel search"
									: "Search again"
							}
							icon={search.searching() ? StopIcon : SearchIcon}
							compact
							disabled={
								search.applying() ||
								(!search.searching() &&
									(!search.query() ||
										c.searchCurrentFile() ||
										!search.roots().length))
							}
							onClick={() =>
								search.searching()
									? search.cancel()
									: void search.search()
							}
						/>
					</div>
					<Show when={c.replaceOpen()}>
						<div class="search-replacement">
							<input
								aria-label="Replace with"
								placeholder="Replace"
								value={search.replacement()}
								disabled={search.applying()}
								onInput={(event) =>
									search.setReplacement(
										event.currentTarget.value,
									)
								}
							/>
						</div>
						<div class="search-replacement-actions">
							<Show when={c.searchCurrentFile()}>
								<button
									type="button"
									disabled={
										c.busy() ||
										!search.choices().length ||
										search.applying()
									}
									onClick={() => void search.replaceOne()}
								>
									Replace
								</button>
							</Show>
							<button
								type="button"
								disabled={
									c.busy() ||
									!search.choices().length ||
									search.searching() ||
									search.applying()
								}
								onClick={() => void search.replaceAll()}
							>
								{c.searchCurrentFile()
									? "Replace all"
									: search.preview()
										? "Apply replacements"
										: "Preview replacements"}
							</button>
						</div>
					</Show>
					<fieldset
						class="search-options"
						aria-label="Search options"
					>
						<button
							type="button"
							class="search-scope"
							aria-label="Current file"
							aria-pressed={c.searchCurrentFile()}
							title="Limit search to the current file"
							disabled={search.applying()}
							onClick={() =>
								c.setSearchCurrentFile((value) => !value)
							}
						>
							<FileIcon size={16} nobox aria-hidden="true" />
							<span>Current file</span>
						</button>
						<button
							type="button"
							class="search-toggle"
							aria-label="Match case"
							aria-pressed={search.matchCase()}
							title="Match case"
							disabled={search.applying()}
							onClick={() =>
								search.setMatchCase((value) => !value)
							}
						>
							Aa
						</button>
						<button
							type="button"
							class="search-toggle"
							aria-label="Whole word"
							aria-pressed={search.wholeWord()}
							title="Match whole word"
							disabled={search.applying()}
							onClick={() =>
								search.setWholeWord((value) => !value)
							}
						>
							<span class="whole-word-symbol">ab</span>
						</button>
						<Show when={!c.searchCurrentFile()}>
							<button
								type="button"
								class="icon-button"
								aria-label="Search exclusions"
								aria-pressed={filters()}
								title="Files to exclude"
								disabled={search.applying()}
								onClick={() => setFilters((value) => !value)}
							>
								<MoreIcon size={18} nobox aria-hidden="true" />
							</button>
						</Show>
					</fieldset>
					<Show when={filters() && !c.searchCurrentFile()}>
						<label class="search-exclusions">
							Files to exclude
							<input
								aria-label="Files to exclude"
								value={search.exclusions()}
								disabled={search.applying()}
								onInput={(event) =>
									search.setExclusions(
										event.currentTarget.value,
									)
								}
							/>
						</label>
					</Show>
				</form>
				<div
					class="search-summary"
					classList={{ "search-idle": !search.query() }}
				>
					<p role="status">{summary()}</p>
					<div>
						<button
							type="button"
							class="icon-button"
							aria-label="Previous match"
							title="Previous match (Shift+F3)"
							disabled={
								!search.choices().length || search.applying()
							}
							onClick={() => search.next(true)}
						>
							<ChevronIcon
								size={18}
								nobox
								aria-hidden="true"
								style={{ transform: "rotate(270deg)" }}
							/>
						</button>
						<button
							type="button"
							class="icon-button"
							aria-label="Next match"
							title="Next match (F3)"
							disabled={
								!search.choices().length || search.applying()
							}
							onClick={() => search.next(false)}
						>
							<ChevronIcon
								size={18}
								nobox
								aria-hidden="true"
								style={{ transform: "rotate(90deg)" }}
							/>
						</button>
					</div>
				</div>
			</div>
			<SearchResults search={search} />
		</aside>
	);
}
