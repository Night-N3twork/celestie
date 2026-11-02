import type { Disposable } from "../api/types";
import type { CommandRegistry, EditorCommand } from "./commands";
import type { KeyboardShortcuts } from "./keyboard-shortcuts";

export class CommandMenu implements Disposable {
	private readonly panel: HTMLDivElement;
	private readonly input: HTMLInputElement;
	private readonly list: HTMLDivElement;
	private readonly status: HTMLDivElement;
	private readonly subscriptions: Disposable[] = [];
	private items: readonly EditorCommand[] = [];
	private index = 0;
	private palette = true;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly commands: CommandRegistry,
		shortcuts: KeyboardShortcuts,
		private readonly host: {
			focus(): void;
			onOpen(): void;
			announce(message: string): void;
		},
	) {
		const document = container.ownerDocument;
		this.panel = document.createElement("div");
		this.panel.className = "editor-command-menu";
		this.panel.hidden = true;
		this.input = document.createElement("input");
		this.input.type = "search";
		this.input.placeholder = "Type a command…";
		this.input.setAttribute("aria-label", "Search editor commands");
		this.input.setAttribute("role", "combobox");
		this.input.setAttribute("aria-autocomplete", "list");
		this.input.setAttribute("aria-expanded", "true");
		this.input.autocomplete = "off";
		this.input.spellcheck = false;
		this.list = document.createElement("div");
		this.list.id = `editor-commands-${crypto.randomUUID()}`;
		this.input.setAttribute("aria-controls", this.list.id);
		this.status = document.createElement("div");
		this.status.className = "editor-command-status";
		this.status.setAttribute("role", "status");
		this.panel.append(this.input, this.list, this.status);
		container.append(this.panel);
		this.input.addEventListener("input", this.filter);
		this.panel.addEventListener("click", this.click);
		this.panel.addEventListener("focusout", this.focusOut);
		document.addEventListener("pointerdown", this.outside, true);
		this.subscriptions.push(
			shortcuts.registerScope(this.panel, [
				{
					id: "commands.close",
					key: "Escape",
					run: () => this.close(),
				},
				{
					id: "commands.down",
					key: "ArrowDown",
					run: () => this.move(1),
				},
				{ id: "commands.up", key: "ArrowUp", run: () => this.move(-1) },
				{
					id: "commands.first",
					key: "Home",
					when: () => !this.palette,
					run: () => {
						this.index = -1;
						this.move(1);
					},
				},
				{
					id: "commands.last",
					key: "End",
					when: () => !this.palette,
					run: () => {
						this.index = 0;
						this.move(-1);
					},
				},
				{
					id: "commands.run",
					key: "Enter",
					when: () => document.activeElement === this.input,
					run: () => this.run(this.items[this.index]?.id),
				},
			]),
		);
	}

	get isOpen(): boolean {
		return !this.panel.hidden;
	}
	open(position?: { x: number; y: number }): void {
		if (this.disposed) return;
		this.host.onOpen();
		this.palette = !position;
		this.panel.hidden = false;
		this.panel.classList.toggle("is-palette", this.palette);
		this.panel.setAttribute("role", this.palette ? "dialog" : "menu");
		this.panel.setAttribute(
			"aria-label",
			this.palette ? "Command palette" : "Editor context menu",
		);
		this.list.setAttribute("role", this.palette ? "listbox" : "none");
		this.input.hidden = !this.palette;
		this.input.value = "";
		this.index = 0;
		if (position) {
			const bounds = this.container.getBoundingClientRect();
			this.panel.style.left = `${Math.max(0, Math.min(bounds.width - 340, position.x - bounds.left))}px`;
			this.panel.style.top = `${Math.max(0, Math.min(bounds.height - 200, position.y - bounds.top))}px`;
		} else {
			this.panel.style.left = "";
			this.panel.style.top = "";
		}
		this.filter();
		if (position) {
			const bounds = this.container.getBoundingClientRect();
			this.panel.style.top = `${Math.max(0, Math.min(bounds.height - this.panel.getBoundingClientRect().height - 8, position.y - bounds.top))}px`;
		}
		if (this.palette) this.input.focus();
		else this.focusItem();
	}

	close(focus = true): void {
		this.panel.hidden = true;
		if (focus) this.host.focus();
	}

	private readonly filter = (): void => {
		const query = this.input.value.toLocaleLowerCase().trim().split(/\s+/);
		this.items = this.commands
			.list()
			.filter(
				(command) =>
					(this.palette || command.menu) &&
					query.every((part) =>
						`${command.label} ${command.id}`
							.toLocaleLowerCase()
							.includes(part),
					),
			);
		this.index = Math.max(
			0,
			this.items.findIndex((item) => this.commands.isEnabled(item.id)),
		);
		this.render();
	};

	private render(): void {
		this.list.replaceChildren();
		this.items.forEach((command, index) => {
			const button = this.list.ownerDocument.createElement("button");
			button.type = "button";
			button.tabIndex = -1;
			button.id = `${this.list.id}-${index}`;
			button.dataset.command = command.id;
			button.setAttribute("role", this.palette ? "option" : "menuitem");
			if (this.palette)
				button.setAttribute(
					"aria-selected",
					String(index === this.index),
				);
			button.classList.toggle("is-active", index === this.index);
			button.disabled = !this.commands.isEnabled(command.id);
			const label = this.list.ownerDocument.createElement("span");
			label.textContent = command.label;
			const key = this.list.ownerDocument.createElement("kbd");
			key.textContent = command.shortcut ?? "";
			button.append(label, key);
			this.list.append(button);
		});
		if (this.items.length)
			this.input.setAttribute(
				"aria-activedescendant",
				`${this.list.id}-${this.index}`,
			);
		else this.input.removeAttribute("aria-activedescendant");
		this.status.textContent = this.items.length
			? `${this.items.length} commands · Escape to close`
			: "No matching commands";
	}

	private move(direction: number): void {
		for (let count = 0; count < this.items.length; count++) {
			this.index =
				(this.index + direction + this.items.length) %
				this.items.length;
			const item = this.items[this.index];
			if (item && this.commands.isEnabled(item.id)) break;
		}
		this.render();
		this.focusItem();
	}

	private focusItem(): void {
		const button = this.list.children[this.index] as
			| HTMLButtonElement
			| undefined;
		if (!this.palette) button?.focus();
		button?.scrollIntoView({ block: "nearest" });
	}

	private run(id: string | undefined): void {
		if (!id || !this.commands.isEnabled(id)) return;
		this.close();
		void this.commands
			.execute(id)
			.catch((error: unknown) =>
				this.host.announce(
					error instanceof Error ? error.message : "Command failed.",
				),
			);
	}
	private readonly click = (event: MouseEvent): void => {
		const target = event.target as HTMLElement;
		this.run(
			target.closest<HTMLButtonElement>("button[data-command]")?.dataset
				.command,
		);
	};
	private readonly outside = (event: PointerEvent): void => {
		if (this.isOpen && !this.panel.contains(event.target as Node))
			this.close(false);
	};
	private readonly focusOut = (event: FocusEvent): void => {
		if (
			event.relatedTarget &&
			!this.panel.contains(event.relatedTarget as Node)
		)
			this.close(false);
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.input.removeEventListener("input", this.filter);
		this.panel.removeEventListener("click", this.click);
		this.panel.removeEventListener("focusout", this.focusOut);
		this.container.ownerDocument.removeEventListener(
			"pointerdown",
			this.outside,
			true,
		);
		for (const subscription of this.subscriptions) subscription.dispose();
		this.panel.remove();
	}
}
