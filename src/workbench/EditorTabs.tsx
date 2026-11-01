import type { Accessor } from "solid-js";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import UnsavedIcon from "../icons/debug/breakpoint.svg";
import FileIcon from "../icons/files/file.svg";
import DiffIcon from "../icons/git/diff.svg";
import type { Workspace } from "../workspace/workspace";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";
import type { createDiffController } from "./createDiffController";

interface Props {
	diffs: ReturnType<typeof createDiffController>;
	documents: Accessor<readonly WorkspaceDocument[]>;
	file: Accessor<WorkspaceDocument | undefined>;
	busy: Accessor<boolean>;
	workspace: Accessor<Workspace>;
	changed: () => void;
	documentName: (document: { name: string }) => string;
	documentDirty: (document: { dirty: boolean }) => boolean;
	close: (id: string) => void;
}

export default function EditorTabs(props: Props) {
	let tabs!: HTMLFieldSetElement;
	const [metrics, setMetrics] = createSignal({
		left: 0,
		width: 0,
		visible: false,
	});
	const measure = () => {
		const { scrollLeft, scrollWidth, clientWidth } = tabs;
		if (scrollWidth <= clientWidth + 1) {
			setMetrics({ left: 0, width: 0, visible: false });
			return;
		}
		const width = Math.max(24, (clientWidth / scrollWidth) * clientWidth);
		const left =
			(scrollLeft / (scrollWidth - clientWidth)) * (clientWidth - width);
		setMetrics({ left, width, visible: true });
	};
	const dragThumb = (event: PointerEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const thumb = event.currentTarget as HTMLElement;
		thumb.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startScroll = tabs.scrollLeft;
		const ratio =
			(tabs.scrollWidth - tabs.clientWidth) /
			Math.max(1, tabs.clientWidth - metrics().width);
		const move = (moveEvent: PointerEvent) => {
			tabs.scrollLeft =
				startScroll + (moveEvent.clientX - startX) * ratio;
		};
		const stop = () => {
			thumb.removeEventListener("pointermove", move);
			thumb.removeEventListener("pointerup", stop);
			thumb.removeEventListener("pointercancel", stop);
		};
		thumb.addEventListener("pointermove", move);
		thumb.addEventListener("pointerup", stop);
		thumb.addEventListener("pointercancel", stop);
	};
	onMount(() => {
		const resize = new ResizeObserver(measure);
		resize.observe(tabs);
		const mutation = new MutationObserver(measure);
		mutation.observe(tabs, { childList: true, subtree: true });
		measure();
		onCleanup(() => {
			resize.disconnect();
			mutation.disconnect();
		});
	});
	createEffect(() => {
		props.file()?.id;
		props.diffs.activeId();
		queueMicrotask(() => {
			const tab = tabs
				?.querySelector('button[aria-pressed="true"]')
				?.closest<HTMLElement>(".editor-tab");
			if (!tab) return;
			const strip = tabs.getBoundingClientRect();
			const rect = tab.getBoundingClientRect();
			if (rect.left < strip.left)
				tabs.scrollLeft -= strip.left - rect.left;
			else if (rect.right > strip.right)
				tabs.scrollLeft += rect.right - strip.right;
		});
	});
	const {
		documents,
		file,
		busy,
		workspace,
		changed,
		documentName,
		documentDirty,
		close,
	} = props;
	return (
		<div class="editor-tabs-container">
			<fieldset
				class="editor-tabs"
				aria-label="Open files"
				ref={tabs}
				onScroll={measure}
				onWheel={(event) => {
					if (event.deltaY === 0 || event.shiftKey) return;
					if (tabs.scrollWidth <= tabs.clientWidth) return;
					event.preventDefault();
					tabs.scrollLeft += event.deltaY;
				}}
			>
				<For each={documents()}>
					{(document) => (
						<div
							class="editor-tab"
							classList={{
								active: file()?.id === document.id,
							}}
						>
							<button
								type="button"
								disabled={busy()}
								aria-pressed={file()?.id === document.id}
								onClick={() => {
									props.diffs.activate(undefined);
									workspace().activate(document.id);
									changed();
								}}
							>
								<FileIcon size={20} nobox aria-hidden="true" />
								{documentName(document)}
								<Show when={documentDirty(document)}>
									<UnsavedIcon
										size={16}
										nobox
										title="Unsaved changes"
										role="img"
										aria-label="Unsaved changes"
									/>
								</Show>
							</button>
							<button
								type="button"
								disabled={busy()}
								aria-label={`Close ${documentName(document)}`}
								onClick={() => close(document.id)}
							>
								<CloseIcon size={18} nobox aria-hidden="true" />
							</button>
						</div>
					)}
				</For>
				<For each={props.diffs.reviews()}>
					{(review) => (
						<div
							class="editor-tab"
							classList={{
								active: props.diffs.activeId() === review.id,
							}}
						>
							<button
								type="button"
								aria-label={`${review.path} (${review.afterLabel} diff)`}
								aria-pressed={
									props.diffs.activeId() === review.id
								}
								title={`${review.beforeLabel} ↔ ${review.afterLabel}: ${review.path}`}
								onClick={() => props.diffs.activate(review.id)}
							>
								<DiffIcon size={20} nobox aria-hidden="true" />
								{review.path.split("/").at(-1)}{" "}
								<span class="diff-tab-label">
									{review.afterLabel === "Index"
										? "Staged"
										: "Diff"}
								</span>
							</button>
							<button
								type="button"
								aria-label={`Close diff ${review.path} (${review.afterLabel})`}
								onClick={() => props.diffs.close(review.id)}
							>
								<CloseIcon size={18} nobox aria-hidden="true" />
							</button>
						</div>
					)}
				</For>
			</fieldset>
			<Show when={metrics().visible}>
				<div class="editor-tabs-scrollbar" aria-hidden="true">
					<div
						class="editor-tabs-thumb"
						style={{
							width: `${metrics().width}px`,
							transform: `translateX(${metrics().left}px)`,
						}}
						onPointerDown={dragThumb}
					/>
				</div>
			</Show>
		</div>
	);
}
