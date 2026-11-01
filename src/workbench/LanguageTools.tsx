import { createEffect, createSignal, For, Show } from "solid-js";
import CloseIcon from "../icons/actions/close.svg";
import { createLanguageTools } from "../language/createLanguageTools";
import ActionButton from "./ActionButton";
import type { WorkbenchController } from "./createWorkbenchController";
import LanguageHover from "./LanguageHover";

export default function LanguageTools(props: {
	controller: WorkbenchController;
}) {
	const tools = createLanguageTools(props.controller);
	const [query, setQuery] = createSignal("");
	let panel: HTMLElement | undefined;
	createEffect(() => {
		tools.title();
		tools.rename();
		tools.items();
		tools.preview();
		setQuery("");
		queueMicrotask(() => (panel?.querySelector("input") ?? panel)?.focus());
	});
	const choices = () =>
		tools
			.items()
			.filter((item) =>
				item.label.toLowerCase().includes(query().toLowerCase()),
			);
	return (
		<>
			<LanguageHover
				controller={props.controller}
				blocked={() => !!tools.title()}
			/>
			<Show when={tools.title()}>
				<section
					class="navigation-palette language-tools"
					role="dialog"
					aria-label={tools.title()}
					aria-modal="true"
					tabIndex={-1}
					ref={panel}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							event.target instanceof HTMLInputElement
						) {
							event.preventDefault();
							if (tools.rename())
								void tools.execute(() =>
									tools.renameSymbol(query()),
								);
							else if (choices()[0])
								void tools.execute(choices()[0].run);
						}
						if (
							event.key === "ArrowDown" ||
							event.key === "ArrowUp"
						) {
							const buttons = [
								...(panel?.querySelectorAll<HTMLButtonElement>(
									"li button",
								) ?? []),
							];
							if (!buttons.length) return;
							event.preventDefault();
							const index = buttons.indexOf(
								document.activeElement as HTMLButtonElement,
							);
							buttons[
								(index +
									(event.key === "ArrowDown" ? 1 : -1) +
									buttons.length) %
									buttons.length
							]?.focus();
						}
					}}
				>
					<h2>{tools.title()}</h2>
					<ActionButton
						label="Close language tools"
						icon={CloseIcon}
						compact
						onClick={tools.close}
					/>
					<Show when={tools.rename() || tools.items().length}>
						<label>
							{tools.rename() ? "New name" : "Filter results"}
							<input
								aria-label={
									tools.rename()
										? "New symbol name"
										: "Filter language results"
								}
								value={query()}
								onInput={(event) =>
									setQuery(event.currentTarget.value)
								}
							/>
						</label>
					</Show>
					<Show when={tools.message()}>
						<pre class="language-message" role="status">
							{tools.message()}
						</pre>
					</Show>
					<Show when={tools.rename()}>
						<button
							type="button"
							onClick={() =>
								void tools.execute(() =>
									tools.renameSymbol(query()),
								)
							}
						>
							Preview rename
						</button>
					</Show>
					<ul>
						<For each={choices()}>
							{(item) => (
								<li>
									<button
										type="button"
										onClick={() =>
											void tools.execute(item.run)
										}
									>
										<span>
											{item.label}
											<small>{item.detail}</small>
										</span>
									</button>
								</li>
							)}
						</For>
					</ul>
					<Show when={tools.preview()}>
						{(preview) => (
							<>
								<div class="language-edit-preview">
									<For each={preview().plan}>
										{(file) => (
											<section>
												<h3>
													{file.id
														.split("/")
														.slice(1)
														.join("/")}
												</h3>
												<div class="diff-preview">
													<section aria-label="Before edit">
														<pre>{file.before}</pre>
													</section>
													<section aria-label="After edit">
														<pre>{file.after}</pre>
													</section>
												</div>
											</section>
										)}
									</For>
								</div>
								<button
									type="button"
									class="primary"
									disabled={!preview().plan.length}
									onClick={() => void tools.apply()}
								>
									Apply changes
								</button>
							</>
						)}
					</Show>
				</section>
			</Show>
		</>
	);
}
