import { For } from "solid-js";
export interface MenuAction {
	label: string;
	shortcut?: string;
	action: () => void;
	disabled?: boolean;
	checked?: boolean;
}
export default function CommandMenu(props: {
	label: string;
	groups: MenuAction[][];
}) {
	let menu!: HTMLDetailsElement;
	const items = () =>
		Array.from(
			menu.querySelectorAll<HTMLButtonElement>(
				'[role^="menuitem"]:not(:disabled)',
			),
		);
	const close = () => {
		menu.open = false;
	};
	return (
		<details
			ref={menu}
			class="view-menu command-menu"
			onToggle={() => {
				if (!menu.open) return;
				const popup = menu.querySelector<HTMLElement>(
					".command-menu-popup",
				);
				if (popup) {
					const rect = menu.getBoundingClientRect();
					popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
					popup.style.top = `${rect.bottom + 2}px`;
				}
			}}
			onKeyDown={(event) => {
				const choices = items(),
					index = choices.indexOf(
						document.activeElement as HTMLButtonElement,
					);
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					close();
					menu.querySelector("summary")?.focus();
				} else if (
					["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
				) {
					event.preventDefault();
					menu.open = true;
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? choices.length - 1
								: event.key === "ArrowDown"
									? (index + 1) % choices.length
									: (index <= 0 ? choices.length : index) - 1;
					choices[next]?.focus();
				} else if (event.key === "Tab") close();
				else if (
					event.key === "ArrowLeft" ||
					event.key === "ArrowRight"
				) {
					event.preventDefault();
					const siblings = Array.from(
						menu.parentElement?.querySelectorAll<HTMLDetailsElement>(
							".command-menu",
						) ?? [],
					);
					const next =
						siblings[
							(siblings.indexOf(menu) +
								(event.key === "ArrowRight"
									? 1
									: siblings.length - 1)) %
								siblings.length
						];
					close();
					if (next) {
						next.open = true;
						next.querySelector<HTMLButtonElement>(
							'[role^="menuitem"]:not(:disabled)',
						)?.focus();
					}
				}
			}}
			onPointerEnter={() => {
				for (const sibling of menu.parentElement?.querySelectorAll<HTMLDetailsElement>(
					".command-menu[open]",
				) ?? [])
					if (sibling !== menu) {
						sibling.open = false;
						menu.open = true;
					}
			}}
		>
			<summary aria-haspopup="menu">{props.label}</summary>
			<div
				class="command-menu-popup"
				role="menu"
				aria-label={props.label}
			>
				<For each={props.groups}>
					{(group, index) => (
						<>
							<For each={group}>
								{(item) => (
									<button
										type="button"
										role={
											item.checked === undefined
												? "menuitem"
												: "menuitemcheckbox"
										}
										{...(item.checked === undefined
											? {}
											: { "aria-checked": item.checked })}
										disabled={item.disabled}
										onClick={() => {
											close();
											item.action();
										}}
									>
										<span class="menu-check">
											{item.checked ? "✓" : ""}
										</span>
										<span>{item.label}</span>
										<span class="menu-shortcut">
											{item.shortcut}
										</span>
									</button>
								)}
							</For>
							{index() < props.groups.length - 1 ? <hr /> : null}
						</>
					)}
				</For>
			</div>
		</details>
	);
}
