import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { LanguageFeatureHost } from "./language-host";
export interface Choice {
	label: string;
	detail?: string;
	disabled?: string;
	preview?: string;
	run(): void;
}
interface Host
	extends Pick<
		LanguageFeatureHost,
		"frame" | "input" | "viewport" | "model" | "point" | "announce"
	> {
	onClose(clearInline: boolean): void;
}
export class LanguagePopup implements Disposable {
	readonly widget: HTMLDivElement;
	readonly ghost: HTMLDivElement;
	choices: Choice[] = [];
	index = 0;
	mode = "";
	private anchorOffset = 0;
	private anchorModel: TextModel | null = null;
	private readonly resize: ResizeObserver;
	private disposed = false;
	private readonly contentResources: Disposable[] = [];
	ownContent(value: Disposable): void {
		if (this.disposed || this.widget.hidden) value.dispose();
		else this.contentResources.push(value);
	}
	private controller: HTMLInputElement | HTMLTextAreaElement | undefined;
	private savedAttributes = new Map<string, string | null>();
	get choiceInput(): HTMLInputElement | HTMLTextAreaElement | undefined {
		return this.controller;
	}
	private bindChoices(
		input: HTMLInputElement | HTMLTextAreaElement,
		list: HTMLElement,
	): void {
		this.controller = input;
		for (const name of [
			"aria-controls",
			"aria-expanded",
			"aria-autocomplete",
			"aria-haspopup",
			"aria-activedescendant",
		])
			this.savedAttributes.set(name, input.getAttribute(name));
		input.setAttribute("aria-controls", list.id);
		if (input !== this.host.input)
			input.setAttribute("aria-expanded", "true");
		input.setAttribute("aria-autocomplete", "list");
		input.setAttribute("aria-haspopup", "listbox");
	}
	updateSelection(): void {
		const options =
			this.widget.querySelectorAll<HTMLElement>('[role="option"]');
		options.forEach((option, index) => {
			option.setAttribute("aria-selected", String(index === this.index));
		});
		const active = options[this.index];
		if (active)
			this.controller?.setAttribute("aria-activedescendant", active.id);
		else this.controller?.removeAttribute("aria-activedescendant");
		active?.scrollIntoView({ block: "nearest" });
		this.updatePreview();
	}
	private describe(visible: boolean): void {
		const input = this.host.input;
		const ids = (input.getAttribute("aria-describedby") ?? "")
			.split(/\s+/)
			.filter((id) => id && id !== this.widget.id);
		if (visible) ids.push(this.widget.id);
		if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
		else input.removeAttribute("aria-describedby");
	}
	private readonly focusOut = (event: FocusEvent): void => {
		const next = event.relatedTarget as Node | null;
		if (next && next !== this.host.input && !this.widget.contains(next))
			this.close();
	};
	constructor(private readonly host: Host) {
		const doc = host.frame.ownerDocument;
		this.widget = doc.createElement("div");
		this.widget.className = "editor-language-widget";
		this.widget.hidden = true;
		this.widget.id = `language-${crypto.randomUUID()}`;
		this.widget.setAttribute("aria-label", "Language assistance");
		this.widget.tabIndex = -1;
		this.ghost = doc.createElement("div");
		this.ghost.className = "editor-inline-completion";
		this.ghost.hidden = true;
		this.ghost.setAttribute("aria-hidden", "true");
		this.resize = new ResizeObserver(() => this.reposition());
		this.resize.observe(host.frame);
		this.resize.observe(this.widget);
		host.viewport.addEventListener("scroll", this.reposition, true);
		this.widget.addEventListener("pointerdown", this.keepFocus);
		this.widget.addEventListener("focusout", this.focusOut);
		host.input.addEventListener("focusout", this.focusOut);
		host.frame.append(this.widget, this.ghost);
	}
	showText(title: string, text: string, offset: number): void {
		this.close();
		const heading = this.widget.ownerDocument.createElement("strong"),
			pre = this.widget.ownerDocument.createElement("pre");
		heading.textContent = title;
		pre.textContent = text;
		this.widget.replaceChildren(heading, pre);
		this.widget.setAttribute("role", "tooltip");
		this.widget.setAttribute("aria-label", title);
		this.describe(true);
		this.widget.hidden = false;
		this.position(this.widget, offset);
	}
	showContent(
		title: string,
		content: HTMLElement,
		offset: number,
		mode = "documentation",
	): void {
		this.close();
		this.mode = mode;
		const heading = this.widget.ownerDocument.createElement("strong");
		heading.textContent = title;
		const close = this.widget.ownerDocument.createElement("button");
		close.type = "button";
		close.textContent = "Close";
		close.onclick = () => this.close();
		this.widget.replaceChildren(heading, content, close);
		this.widget.setAttribute("role", "dialog");
		this.widget.setAttribute("aria-label", title);
		this.widget.hidden = false;
		this.position(this.widget, offset);
	}
	showChoices(
		mode: string,
		choices: Choice[],
		offset: number,
		filter = false,
	): void {
		this.close(false);
		this.mode = mode;
		if (!choices.length) {
			if (mode !== "complete") this.host.announce("No results.");
			return;
		}
		let matchingCount = choices.length;
		this.choices = choices.slice(0, 1000);
		this.index = 0;
		this.widget.setAttribute("role", "group");
		this.widget.setAttribute(
			"aria-label",
			mode === "complete" ? "Suggestions" : "Language results",
		);
		this.widget.hidden = false;
		const list = this.widget.ownerDocument.createElement("div");
		list.className = "editor-language-list";
		list.id = `${this.widget.id}-list`;
		list.setAttribute("role", "listbox");
		list.setAttribute(
			"aria-label",
			mode === "complete" ? "Suggestions" : "Language results",
		);
		const status = this.widget.ownerDocument.createElement("div");
		status.className = "editor-language-result-status";
		status.setAttribute("role", "status");
		const preview = this.widget.ownerDocument.createElement("pre");
		preview.className = "editor-location-preview";
		const render = () => {
			const fragment = list.ownerDocument.createDocumentFragment();
			for (let index = 0; index < this.choices.length; index++) {
				const choice = this.choices[index];
				if (!choice) continue;
				const option = list.ownerDocument.createElement("button");
				option.type = "button";
				option.tabIndex = -1;
				option.id = `${this.widget.id}-${index}`;
				option.setAttribute("role", "option");
				option.setAttribute(
					"aria-selected",
					String(index === this.index),
				);
				option.textContent = choice.label;
				option.setAttribute("aria-disabled", String(!!choice.disabled));
				const detail = list.ownerDocument.createElement("small");
				detail.textContent = choice.disabled ?? choice.detail ?? "";
				option.append(detail);
				option.onclick = () => this.acceptChoice(index);
				fragment.append(option);
			}
			list.replaceChildren(fragment);
			status.textContent = this.choices.length
				? matchingCount > this.choices.length
					? `Showing ${this.choices.length} of ${matchingCount} results. Filter to narrow the list.`
					: `${matchingCount} results`
				: "No results";
			this.updateSelection();
		};
		this.widget.replaceChildren();
		if (filter) {
			const input = this.widget.ownerDocument.createElement("input");
			input.setAttribute("aria-label", "Filter results");
			input.placeholder = "Filter results";
			input.setAttribute("role", "combobox");
			input.autocomplete = "off";
			this.bindChoices(input, list);
			input.oninput = () => {
				const matching = choices.filter((choice) =>
					choice.label
						.toLowerCase()
						.includes(input.value.toLowerCase()),
				);
				matchingCount = matching.length;
				this.choices = matching.slice(0, 1000);
				this.index = 0;
				render();
				this.updatePreview();
			};
			this.widget.append(input);
			queueMicrotask(() => {
				if (
					!this.disposed &&
					!this.widget.hidden &&
					this.controller === input &&
					input.isConnected
				)
					input.focus();
			});
		}
		if (!filter) {
			this.bindChoices(this.host.input, list);
			this.host.input.focus({ preventScroll: true });
		}
		this.widget.append(list);
		this.widget.append(preview, status);
		render();
		this.position(this.widget, offset);
		this.updatePreview();
	}
	updatePreview(): void {
		const preview = this.widget.querySelector<HTMLElement>(
			".editor-location-preview",
		);
		if (preview) {
			preview.textContent = this.choices[this.index]?.preview ?? "";
			preview.hidden = !preview.textContent;
		}
	}
	acceptChoice(index: number): void {
		const choice = this.choices[index];
		if (choice?.disabled) {
			this.host.announce(choice.disabled);
			return;
		}
		this.close();
		this.host.input.focus({ preventScroll: true });
		choice?.run();
	}
	position(element: HTMLElement, offset: number): void {
		this.anchorOffset = offset;
		this.anchorModel = this.host.model();
		const point = this.host.point(offset),
			bounds = this.host.frame.getBoundingClientRect();
		if (element === this.ghost) {
			element.style.left = `${point.x - bounds.left}px`;
			element.style.top = `${point.y - bounds.top}px`;
			return;
		}
		const frame = this.host.frame;
		const scaleX = bounds.width / Math.max(1, frame.offsetWidth) || 1;
		const scaleY = bounds.height / Math.max(1, frame.offsetHeight) || 1;
		const width = element.offsetWidth,
			height = element.offsetHeight;
		const below = (point.y + point.height - bounds.top) / scaleY;
		const above = (point.y - bounds.top) / scaleY - height;
		const top = below + height <= frame.clientHeight - 8 ? below : above;
		element.style.left = `${Math.max(8, Math.min((point.x - bounds.left) / scaleX, frame.clientWidth - width - 8))}px`;
		element.style.top = `${Math.max(8, Math.min(top, frame.clientHeight - height - 8))}px`;
	}
	private readonly reposition = (): void => {
		if (this.disposed || (this.widget.hidden && this.ghost.hidden)) return;
		if (this.host.model() !== this.anchorModel) {
			this.close();
			return;
		}
		const point = this.host.point(this.anchorOffset),
			bounds = this.host.viewport.getBoundingClientRect();
		if (point.y < bounds.top || point.y > bounds.bottom) {
			this.close();
			return;
		}
		if (!this.widget.hidden) this.position(this.widget, this.anchorOffset);
		if (!this.ghost.hidden) this.position(this.ghost, this.anchorOffset);
	};
	private readonly keepFocus = (event: PointerEvent): void => {
		if (
			event.target instanceof Element &&
			event.target.closest('[role="option"]')
		)
			event.preventDefault();
	};
	close(clearInline = true): void {
		const focused = this.widget.contains(
			this.widget.ownerDocument.activeElement,
		);
		this.widget.hidden = true;
		for (const resource of this.contentResources.splice(0))
			resource.dispose();
		this.describe(false);
		for (const [name, value] of this.savedAttributes) {
			if (value === null) this.controller?.removeAttribute(name);
			else this.controller?.setAttribute(name, value);
		}
		this.savedAttributes.clear();
		this.controller = undefined;
		this.widget.replaceChildren();
		this.mode = "";
		this.choices = [];
		this.host.onClose(clearInline);
		if (focused && !this.disposed)
			this.host.input.focus({ preventScroll: true });
		if (clearInline) {
			this.ghost.hidden = true;
		}
	}
	dispose(): void {
		this.disposed = true;
		this.close();
		this.resize.disconnect();
		this.host.viewport.removeEventListener("scroll", this.reposition, true);
		this.widget.removeEventListener("pointerdown", this.keepFocus);
		this.widget.removeEventListener("focusout", this.focusOut);
		this.host.input.removeEventListener("focusout", this.focusOut);
		this.widget.remove();
		this.ghost.remove();
	}
}
