import type { EditorOptions } from "../api/editor-options";
import type { Disposable } from "../api/types";

export function describeEditorInput(
	input: HTMLTextAreaElement,
	options: Pick<
		EditorOptions,
		"tabFocusMode" | "readOnly" | "accessibilitySupport"
	>,
): void {
	const tab =
		options.tabFocusMode || options.readOnly
			? "Tab and Shift+Tab move focus."
			: "Tab indents; Shift+Tab outdents. Press Escape, then Tab to move focus.";
	const reading =
		options.accessibilitySupport === "on"
			? "Full document screen-reader mode is on."
			: "For full document access, use Toggle Screen Reader Mode in the command palette.";
	input.setAttribute(
		"aria-description",
		`${tab} Press F1 for editor commands. ${reading}`,
	);
	input.title = tab;
}

export class EditorAnnouncer implements Disposable {
	private readonly region: HTMLDivElement;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	constructor(frame: HTMLElement) {
		this.region = frame.ownerDocument.createElement("div");
		this.region.className = "editor-announcement";
		this.region.setAttribute("role", "status");
		this.region.setAttribute("aria-live", "polite");
		this.region.setAttribute("aria-atomic", "true");
		frame.append(this.region);
	}
	announce(message: string): void {
		if (this.disposed) return;
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.region.textContent = "";
		if (message)
			this.timer = setTimeout(() => {
				this.timer = undefined;
				if (!this.disposed) this.region.textContent = message;
			}, 50);
	}
	dispose(): void {
		this.disposed = true;
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.region.remove();
	}
}
