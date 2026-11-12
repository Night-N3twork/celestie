import type { Disposable } from "../api/types";
import type { EditorView } from "../view/editor-view";
export class DeletedBlock implements Disposable {
	readonly node: HTMLDivElement;
	private readonly subscription: Disposable;
	private first = -1;
	private last = -1;
	private frame = 0;
	constructor(
		private readonly view: EditorView,
		private readonly pane: HTMLElement,
		private readonly lines: readonly string[],
		private readonly startLine: number,
	) {
		this.node = pane.ownerDocument.createElement("div");
		this.node.className = "editor-diff-deleted-block";
		this.node.setAttribute(
			"aria-label",
			`Removed original lines ${startLine + 1} to ${startLine + lines.length}`,
		);
		this.node.dataset.editorWidget = "diff-deletions";
		this.subscription = view.onDidScroll(this.schedule);
		this.schedule();
	}
	private readonly schedule = (): void => {
		if (!this.frame) this.frame = requestAnimationFrame(this.paint);
	};
	readonly paint = (): void => {
		this.frame = 0;
		if (!this.node.isConnected) return;
		const viewport = this.pane.getBoundingClientRect(),
			bounds = this.node.getBoundingClientRect(),
			height = this.view.getViewport().lineHeight;
		if (
			this.node.closest("[hidden]") ||
			bounds.bottom < viewport.top ||
			bounds.top > viewport.bottom
		) {
			if (this.first !== -1) this.node.replaceChildren();
			this.first = -1;
			this.last = -1;
			return;
		}
		const first = Math.max(
				0,
				Math.min(
					this.lines.length,
					Math.floor((viewport.top - bounds.top) / height) - 3,
				),
			),
			last = Math.min(
				this.lines.length,
				Math.max(
					first,
					Math.ceil((viewport.bottom - bounds.top) / height) + 3,
				),
			);
		if (first === this.first && last === this.last) return;
		this.first = first;
		this.last = last;
		const fragment = this.node.ownerDocument.createDocumentFragment();
		for (let index = first; index < last; index++) {
			const row = this.node.ownerDocument.createElement("div"),
				number = this.node.ownerDocument.createElement("span"),
				text = this.node.ownerDocument.createElement("span");
			row.className = "editor-diff-deleted-row";
			row.style.top = `${index * height}px`;
			row.style.height = `${height}px`;
			row.style.lineHeight = `${height}px`;
			number.className = "editor-diff-old-number";
			number.textContent = `${this.startLine + index + 1} −`;
			number.setAttribute("aria-hidden", "true");
			const value = this.lines[index] ?? "";
			text.textContent =
				value.slice(0, 20_000) +
				(value.length > 20_000
					? " … (open original for full line)"
					: "");
			row.append(number, text);
			fragment.append(row);
		}
		this.node.replaceChildren(fragment);
	};
	dispose(): void {
		this.subscription.dispose();
		if (this.frame) cancelAnimationFrame(this.frame);
		this.node.remove();
	}
}
