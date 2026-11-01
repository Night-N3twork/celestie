import { createMemo, For, Show } from "solid-js";
import FileIcon from "../icons/files/file.svg";
import ChevronIcon from "../icons/navigation/chevron.svg";
import ErrorIcon from "../icons/panels/error.svg";
import type { Problem } from "../language/protocol";
import type { WorkbenchController } from "../workbench/createWorkbenchController";

export default function ProblemsPanel(props: {
	controller: WorkbenchController;
	visible: boolean;
}) {
	const c = props.controller;
	const groups = createMemo(() => {
		const files = new Map<string, Problem[]>();
		for (const problem of c.language.problems()) {
			const list = files.get(problem.id) ?? [];
			list.push(problem);
			files.set(problem.id, list);
		}
		return [...files].map(([id, problems]) => {
			const root = c
				.folders()
				.find((folder) => id.startsWith(`${folder.entry.id}/`));
			const path = root
				? `${root.entry.name}/${id.slice(root.entry.id.length + 1)}`
				: id;
			const name =
				c.documents().find((doc) => doc.id === id)?.name ??
				path.split("/").at(-1);
			return {
				id,
				problems,
				name,
				directory:
					root || id.includes("/")
						? path.split("/").slice(0, -1).join("/")
						: "",
			};
		});
	});
	return (
		<section
			class="problems-panel"
			aria-label="Problems"
			hidden={!props.visible}
		>
			<Show when={c.language.status()}>
				<p class="problems-status">{c.language.status()}</p>
			</Show>
			<Show
				when={groups().length}
				fallback={
					<div class="tool-empty">
						No problems detected in open files.
					</div>
				}
			>
				<For each={groups()}>
					{(group) => (
						<details class="problem-file" open>
							<summary>
								<ChevronIcon
									size={16}
									nobox
									aria-hidden="true"
								/>
								<FileIcon size={16} nobox aria-hidden="true" />
								<strong>{group.name}</strong>
								<span class="problem-path">
									{group.directory}
								</span>
								<span class="git-count">
									{group.problems.length}
								</span>
							</summary>
							<For each={group.problems}>
								{(problem) => (
									<button
										type="button"
										class="problem-row"
										title={problem.message}
										onClick={() =>
											void c.perform(() =>
												c.navigateFile(problem.id, {
													anchor: problem.from,
													head: problem.to,
												}),
											)
										}
									>
										<span
											class={`problem-severity ${problem.severity}`}
											role="img"
											aria-label={problem.severity}
										>
											<ErrorIcon
												size={16}
												nobox
												aria-hidden="true"
											/>
										</span>
										<span class="problem-message">
											{problem.message}
										</span>
										<span class="problem-location">
											[{problem.line}, {problem.column}]
										</span>
										<span class="problem-code">
											{problem.code}
										</span>
									</button>
								)}
							</For>
						</details>
					)}
				</For>
			</Show>
		</section>
	);
}
