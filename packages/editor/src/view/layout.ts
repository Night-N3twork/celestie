export function calculateViewport(
	lineCount: number,
	scrollTop: number,
	viewportHeight: number,
	lineHeight: number,
) {
	const overscan = 3;
	const totalHeight = lineCount * lineHeight;

	const maxScroll = Math.max(0, totalHeight - viewportHeight);
	const top = Math.max(0, Math.min(scrollTop, maxScroll));

	const firstLine = Math.max(1, Math.floor(top / lineHeight) + 1 - overscan);

	const lastLine = Math.min(
		lineCount,
		Math.ceil((top + viewportHeight) / lineHeight) + overscan,
	);

	return {
		firstLine,
		lastLine,
		offsetTop: (firstLine - 1) * lineHeight,
		totalHeight,
	};
}
