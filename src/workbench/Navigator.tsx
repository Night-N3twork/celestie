import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type { CommandRegistry } from "../commands/registry";
import CloseIcon from "../icons/actions/close.svg";
import type { BrowserFileHost } from "../platform/browser/fileHost";
import type { ExplorerEntry } from "../platform/host";
import { listFiles, symbols } from "../workspace/navigation";

export type NavigationMode = "files" | "commands" | "symbols";

export default function Navigator(props: {
	mode: NavigationMode | undefined;
	focusRequest: number;
	host: BrowserFileHost;
	roots: readonly ExplorerEntry[];
	commands: CommandRegistry;
	text: () => string;
	documents: () => readonly { id: string; name: string }[];
	onFile: (id: string) => Promise<void>;
	onLocation: (offset: number) => void;
	onCommand: (id: string) => Promise<unknown>;
	onClose: () => void;
}) {
	let input!: HTMLInputElement;
	let list!: HTMLUListElement;
	const [query, setQuery] = createSignal("");
	const [selected, setSelected] = createSignal(0);
	const [files, setFiles] = createSignal<
		{ entry: ExplorerEntry; path: string }[]
	>([]);
	const [message, setMessage] = createSignal("");
	let controller: AbortController | undefined;
	const rootKey = createMemo(() =>
		props.roots.map((root) => root.id).join("\0"),
	);
	onCleanup(() => controller?.abort());
	const choices = createMemo(() => {
		const filter = query().toLocaleLowerCase();
		if (props.mode === "commands")
			return props.commands
				.list()
				.map((command) => ({
					id: command.id,
					label: command.title,
					offset: 0,
				}))
				.filter((choice) =>
					choice.label.toLocaleLowerCase().includes(filter),
				)
				.slice(0, 100);
		if (props.mode === "symbols")
			return symbols(props.text())
				.map((symbol) => ({
					id: String(symbol.offset),
					label: `${symbol.name} :${symbol.line}`,
					offset: symbol.offset,
				}))
				.filter((choice) =>
					choice.label.toLocaleLowerCase().includes(filter),
				)
				.slice(0, 100);
		const known = new Map(
			props
				.documents()
				.map((document) => [
					document.id,
					{ id: document.id, label: document.name, offset: 0 },
				]),
		);
		for (const file of files())
			known.set(file.entry.id, {
				id: file.entry.id,
				label: file.path,
				offset: 0,
			});
		return [...known.values()]
			.filter((choice) =>
				choice.label.toLocaleLowerCase().includes(filter),
			)
			.slice(0, 100);
	});
	createEffect(() => {
		if (selected() >= choices().length)
			setSelected(Math.max(0, choices().length - 1));
	});
	createEffect(
		on(
			() => [props.mode, props.focusRequest, rootKey()],
			() => {
				controller?.abort();
				setQuery("");
				setSelected(0);
				setMessage("");
				if (!props.mode) return;
				input.focus();
				if (props.mode === "files") {
					const current = new AbortController();
					controller = current;
					setFiles([]);
					setMessage("Indexing files…");
					void listFiles(props.host, props.roots, current.signal)
						.then((files) => {
							if (!current.signal.aborted) {
								setFiles(files);
								setMessage(
									`${files.length} folder files indexed. Showing up to 100 matching entries.`,
								);
							}
						})
						.catch((error) => {
							if (!current.signal.aborted)
								setMessage(String(error));
						});
				}
			},
		),
	);
	const choose = async (index: number) => {
		const choice = choices()[index];
		if (!choice) return;
		const mode = props.mode;
		props.onClose();
		try {
			if (mode === "commands") await props.onCommand(choice.id);
			else if (mode === "symbols") props.onLocation(choice.offset);
			else await props.onFile(choice.id);
		} catch (error) {
			setMessage(String(error));
		}
	};
	createEffect(() => {
		selected();
		choices();
		if (props.mode && list)
			list.querySelector<HTMLButtonElement>(
				'[aria-current="true"]',
			)?.scrollIntoView({ block: "nearest" });
	});
	return (
		<Show when={props.mode}>
			<form
				class="navigation-palette"
				aria-label="Navigation"
				style={{
					"max-height": "40vh",
					overflow: "auto",
					"flex-shrink": 0,
				}}
				onSubmit={(event) => {
					event.preventDefault();
					void choose(selected());
				}}
				onKeyDown={(event) => {
					if (event.isComposing) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					}
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						setSelected((value) =>
							Math.max(
								0,
								Math.min(
									choices().length - 1,
									value +
										(event.key === "ArrowDown" ? 1 : -1),
								),
							),
						);
					}
				}}
			>
				<label>
					{props.mode === "commands"
						? "Command palette"
						: props.mode === "symbols"
							? "Go to symbol"
							: "Quick open"}{" "}
					<input
						ref={input}
						value={query()}
						onInput={(event) => {
							setQuery(event.currentTarget.value);
							setSelected(0);
						}}
					/>
				</label>
				<button
					type="button"
					aria-label="Close navigation"
					title="Close (Escape)"
					onClick={props.onClose}
				>
					<CloseIcon size={24} nobox aria-hidden="true" />
				</button>
				<p role="status">
					{message()}{" "}
					{choices().length
						? `${selected() + 1} of ${choices().length}: ${choices()[selected()]?.label ?? ""}`
						: "No matching entries."}
				</p>
				<ul ref={list}>
					<For each={choices()}>
						{(choice, index) => (
							<li>
								<button
									type="button"
									aria-current={
										selected() === index()
											? "true"
											: undefined
									}
									onClick={() => void choose(index())}
								>
									{choice.label}
								</button>
							</li>
						)}
					</For>
				</ul>
			</form>
		</Show>
	);
}
