export function pointerPosition(
	input: HTMLTextAreaElement,
	x: number,
	y: number,
): number | undefined {
	const mirror = document.createElement("div"),
		style = getComputedStyle(input),
		box = input.getBoundingClientRect();
	for (const property of [
		"font-family",
		"font-size",
		"font-weight",
		"font-style",
		"line-height",
		"letter-spacing",
		"tab-size",
		"white-space",
		"overflow-wrap",
		"word-break",
		"text-indent",
		"padding",
		"border",
		"box-sizing",
	])
		mirror.style.setProperty(property, style.getPropertyValue(property));
	Object.assign(mirror.style, {
		position: "fixed",
		left: `${box.left}px`,
		top: `${box.top}px`,
		width: `${box.width}px`,
		height: `${box.height}px`,
		overflow: "auto",
		opacity: "0",
		zIndex: "2147483647",
		pointerEvents: "auto",
	});
	const node = document.createTextNode(input.value);
	mirror.append(node);
	document.body.append(mirror);
	mirror.scrollTop = input.scrollTop;
	mirror.scrollLeft = input.scrollLeft;
	try {
		const position = document.caretPositionFromPoint(x, y);
		return position?.offsetNode === node ? position.offset : undefined;
	} finally {
		mirror.remove();
	}
}
