import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import type { LanguageFeatureHost } from "./language-host";
export interface Choice {
	label: string;
	detail?: string;
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
	private anchorOffset = 0;
	private anchorModel: TextModel | null = null;
	private readonly resize: ResizeObserver;
	private disposed = false;
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
		host.viewport.addEventListener("scroll", this.reposition, true);
		this.widget.addEventListener("pointerdown", this.keepFocus);
		host.frame.append(this.widget, this.ghost);
	}
	showText(title: string, text: string, offset: number): void {
		this.choices = [];
		const heading = this.widget.ownerDocument.createElement("strong"),
			pre = this.widget.ownerDocument.createElement("pre");
		heading.textContent = title;
		pre.textContent = text;
		this.widget.replaceChildren(heading, pre);
		this.widget.setAttribute("role", "tooltip");
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
		if (!choices.length) {
			if (mode !== "complete") this.host.announce("No results.");
			return;
		}
		this.choices = choices;
		this.index = 0;
		this.widget.setAttribute("role", "listbox");
		this.widget.hidden = false;
		const list = this.widget.ownerDocument.createElement("div");
		list.className = "editor-language-list";
		const render = () => {
			const fragment = list.ownerDocument.createDocumentFragment();
			for (let index = 0; index < this.choices.length; index++) {
				const choice = this.choices[index];
				if (!choice) continue;
				const option = list.ownerDocument.createElement("button");
				option.type = "button";
				option.id = `${this.widget.id}-${index}`;
				option.setAttribute("role", "option");
				option.setAttribute(
					"aria-selected",
					String(index === this.index),
				);
				option.textContent = choice.label;
				const detail = list.ownerDocument.createElement("small");
				detail.textContent = choice.detail ?? "";
				option.append(detail);
				option.onclick = () => this.acceptChoice(index);
				fragment.append(option);
			}
			list.replaceChildren(fragment);
			this.host.input.setAttribute(
				"aria-activedescendant",
				`${this.widget.id}-${this.index}`,
			);
		};
		this.widget.replaceChildren();
		if (filter) {
			const input = this.widget.ownerDocument.createElement("input");
			input.setAttribute("aria-label", "Filter results");
			input.placeholder = "Filter results";
			input.oninput = () => {
				this.choices = choices.filter((choice) =>
					choice.label
						.toLowerCase()
						.includes(input.value.toLowerCase()),
				);
				this.index = 0;
				render();
			};
			this.widget.append(input);
			queueMicrotask(() => input.focus());
		}
		this.widget.append(list);
		render();
		this.host.input.setAttribute("aria-controls", this.widget.id);
		this.host.input.setAttribute("aria-expanded", "true");
		this.host.input.setAttribute("aria-autocomplete", "list");
		this.position(this.widget, offset);
	}
	acceptChoice(index: number): void {
		const choice = this.choices[index];
		this.close();
		choice?.run();
		this.host.input.focus({ preventScroll: true });
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
		element.style.left = `${Math.max(8, Math.min(point.x - bounds.left, bounds.width - 360))}px`;
		element.style.top = `${Math.max(8, Math.min(point.y + point.height - bounds.top, bounds.height - 180))}px`;
	}
	private readonly reposition = (): void => {
		if (this.disposed) return;
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
		if (event.target instanceof Element && event.target.closest("button"))
			event.preventDefault();
	};
	close(clearInline = true): void {
		this.widget.hidden = true;
		this.widget.replaceChildren();
		this.choices = [];
		this.host.onClose(clearInline);
		this.host.input.removeAttribute("aria-activedescendant");
		this.host.input.setAttribute("aria-expanded", "false");
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
		this.widget.remove();
		this.ghost.remove();
	}
}
