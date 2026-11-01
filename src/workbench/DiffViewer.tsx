import { diffLines } from "diff";
import { createMemo, For, Show } from "solid-js";
import FileIcon from "../icons/files/file.svg";
import ActionButton from "./ActionButton";
import type { DiffReview } from "./createDiffController";

type Line = {
	number: number;
	text: string;
	kind: "same" | "added" | "removed";
};
type Row = { left?: Line; right?: Line };
function compare(before: string, after: string) {
	if (before.length + after.length > 4 * 1024 * 1024) return undefined;
	const parts = diffLines(before, after, {
		timeout: 200,
		maxEditLength: 10000,
	});
	if (!parts) return undefined;
	const rows: Row[] = [];
	let oldLine = 1,
		newLine = 1,
		removed: Line[] = [];
	const flush = () => {
		for (const left of removed) rows.push({ left });
		removed = [];
	};
	for (const part of parts) {
		const lines = part.value.split(/\r\n|\r|\n/);
		if (lines.length > 20000) return undefined;
		if (/\r$|\n$/.test(part.value)) lines.pop();
		if (part.removed) {
			removed.push(
				...lines.map((text) => ({
					number: oldLine++,
					text,
					kind: "removed" as const,
				})),
			);
		} else if (part.added) {
			const added = lines.map((text) => ({
				number: newLine++,
				text,
				kind: "added" as const,
			}));
			for (let i = 0; i < Math.max(removed.length, added.length); i++)
				rows.push({ left: removed[i], right: added[i] });
			removed = [];
		} else {
			flush();
			for (const text of lines)
				rows.push({
					left: { number: oldLine++, text, kind: "same" },
					right: { number: newLine++, text, kind: "same" },
				});
		}
		if (rows.length > 20000) return undefined;
	}
	flush();
	return rows.length > 20000 ? undefined : rows;
}
export default function DiffViewer(props: {
	review: DiffReview;
	onOpen: () => void;
}) {
	const rows = createMemo(() =>
		compare(props.review.before, props.review.after),
	);
	let left!: HTMLElement, right!: HTMLElement;
	const sync = (source: HTMLElement, target: HTMLElement) => {
		if (Math.abs(target.scrollTop - source.scrollTop) > 1)
			target.scrollTop = source.scrollTop;
	};
	const summary = () =>
		`${rows()?.filter((row) => row.right?.kind === "added").length ?? 0} added · ${rows()?.filter((row) => row.left?.kind === "removed").length ?? 0} removed`;
	return (
		<section
			class="diff-editor"
			aria-label={`Diff for ${props.review.path}`}
		>
			<header class="diff-editor-toolbar">
				<span title={props.review.path}>{props.review.path}</span>
				<span class="diff-summary">{summary()}</span>
				<Show when={props.review.canOpen}>
					<ActionButton
						label="Open working file"
						icon={FileIcon}
						onClick={props.onOpen}
					/>
				</Show>
			</header>
			<div class="diff-pane-headings">
				<h3>{props.review.beforeLabel}</h3>
				<h3>{props.review.afterLabel}</h3>
			</div>
			<Show
				when={rows()}
				fallback={
					<p class="diff-limit">
						This diff is too large to compare. Open the file to
						inspect its contents.
					</p>
				}
			>
				<div class="diff-panes">
					<For each={["left", "right"] as const}>
						{(side) => (
							<section
								class="diff-pane"
								aria-label={
									side === "left"
										? "Original version"
										: "Changed version"
								}
								ref={(element) => {
									if (side === "left") left = element;
									else right = element;
								}}
								onScroll={(event) =>
									sync(
										event.currentTarget,
										side === "left" ? right : left,
									)
								}
							>
								<div class="diff-lines">
									<For each={rows()}>
										{(row) => (
											<div
												class={`diff-line ${row[side]?.kind ?? "empty"}`}
											>
												<span class="diff-line-number">
													{row[side]?.number}
												</span>
												<span
													class="diff-line-sign"
													aria-hidden="true"
												>
													{row[side]?.kind === "added"
														? "+"
														: row[side]?.kind ===
																"removed"
															? "−"
															: " "}
												</span>
												<code>
													{row[side]?.text || " "}
												</code>
											</div>
										)}
									</For>
								</div>
							</section>
						)}
					</For>
				</div>
			</Show>
		</section>
	);
}
