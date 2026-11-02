import type { Disposable } from "../api/types";
import type { TextModel } from "../model/text-model";
import { calculateViewport } from "./layout";

export class TextRenderer {
	private readonly scroller: HTMLDivElement;
	private readonly spacer: HTMLDivElement;
	private readonly rows: HTMLDivElement;
	private readonly subscription: Disposable;
	private readonly lineHeight = 24;

	constructor(
		container: HTMLElement,
		private readonly model: TextModel,
	) {
		const document = container.ownerDocument;

		this.scroller = document.createElement("div");
		this.scroller.style.cssText = `
            height: 512px;
            overflow: auto;
            font: 16px/24px monospace;
        `;

		this.spacer = document.createElement("div");
		this.spacer.style.position = "relative";

		this.rows = document.createElement("div");
		this.rows.style.cssText = `
            position: absolute;
            left: 0;
            min-width: 100%;
            width: max-content;
            white-space: pre;
        `;

		this.spacer.appendChild(this.rows);
		this.scroller.appendChild(this.spacer);
		container.appendChild(this.scroller);

		this.scroller.addEventListener("scroll", this.draw);
		this.subscription = model.onDidChangeContent(this.draw);

		this.draw();
	}

	private readonly draw = (): void => {
		const lineCount = this.model.getLineCount();

		this.spacer.style.height = `${lineCount * this.lineHeight}px`;

		const viewport = calculateViewport(
			lineCount,
			this.scroller.scrollTop,
			this.scroller.clientHeight,
			this.lineHeight,
		);

		this.rows.style.top = `${viewport.offsetTop}px`;

		const fragment = this.scroller.ownerDocument.createDocumentFragment();

		for (let line = viewport.firstLine; line <= viewport.lastLine; line++) {
			const row = this.scroller.ownerDocument.createElement("div");

			row.style.height = `${this.lineHeight}px`;
			row.textContent = this.model.getLineContent(line);

			fragment.appendChild(row);
		}

		this.rows.replaceChildren(fragment);
	};

	dispose(): void {
		this.scroller.removeEventListener("scroll", this.draw);
		this.subscription.dispose();
		this.scroller.remove();
	}
}
