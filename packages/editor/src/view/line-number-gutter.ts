import type { FoldRegion, VisualRow } from "./visual-layout";
export class LineNumberGutter {
	private readonly element: HTMLDivElement;
	constructor(
		container: HTMLElement,
		_lineHeight = 24,
		_onSelectLine?: (line: number) => void,
	) {
		this.element = container.ownerDocument.createElement("div");
		this.element.className = "editor-gutter editor-gutter-interactive";
		this.element.setAttribute("aria-hidden", "true");
		container.append(this.element);
	}
	renderRows(
		rows: readonly VisualRow[],
		scrollTop: number,
		height: number,
		lineHeight: number,
		padding: number,
		lineCount: number,
		active: number,
		mode: "on" | "off" | "relative",
		folds: readonly FoldRegion[],
		glyphs: ReadonlyMap<
			number,
			{ label: string; title: string; color: string }
		>,
		rowTop: (index: number) => number = (index) => index * lineHeight,
	): void {
		this.element.style.width =
			mode === "off"
				? "22px"
				: `calc(${Math.max(3, String(lineCount).length)}ch + 32px)`;
		this.element.style.height = `${height}px`;
		const fragment = this.element.ownerDocument.createDocumentFragment();
		for (const row of rows) {
			const number = this.element.ownerDocument.createElement("div");
			number.dataset.line = String(row.line);
			number.classList.toggle("is-active", row.line === active);
			number.style.cssText = `position:absolute;left:0;right:0;top:${padding + rowTop(row.index) - scrollTop}px;height:${lineHeight}px;line-height:${lineHeight}px`;
			const fold = folds.find((value) => value.start === row.line);
			if (fold && row.from === 0 && row.kind !== "zone") {
				const button = this.element.ownerDocument.createElement("span");
				button.dataset.fold = String(row.line);
				button.className = "editor-fold-toggle";
				button.textContent = fold.collapsed ? "▸" : "▾";
				number.append(button);
			}
			const glyph = glyphs.get(row.line);
			if (glyph && row.from === 0 && row.kind !== "zone") {
				const icon = this.element.ownerDocument.createElement("span");
				icon.className = "editor-gutter-glyph";
				icon.textContent = glyph.label;
				icon.title = glyph.title;
				icon.style.color = glyph.color;
				number.append(icon);
			}
			const label = this.element.ownerDocument.createElement("span");
			label.textContent =
				mode === "off" || row.kind === "zone"
					? ""
					: row.from
						? "↪"
						: mode === "relative" && row.line !== active
							? String(Math.abs(row.line - active))
							: String(row.line);
			number.append(label);
			fragment.append(number);
		}
		this.element.replaceChildren(fragment);
	}
	setActiveLine(_line: number): void {}
	dispose(): void {
		this.element.remove();
	}
}
