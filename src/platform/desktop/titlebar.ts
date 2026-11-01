import { unwrap } from "./bridge";

export function synchronizeTitlebar(header: HTMLElement) {
	const bridge = window.celestie;
	if (!bridge?.window) return () => {};
	const color = (value: string) => {
		const components = value.match(/[\d.]+/g);
		return components
			? `#${components
					.slice(0, 3)
					.map((value) =>
						Math.round(Number(value)).toString(16).padStart(2, "0"),
					)
					.join("")}`
			: "#08080a";
	};
	const update = () => {
		const style = getComputedStyle(header);
		void unwrap(
			bridge.window.theme(
				color(style.backgroundColor),
				color(style.color),
				header.getBoundingClientRect().height,
			),
		).catch(console.error);
	};
	const scheme = matchMedia("(prefers-color-scheme: dark)");
	const resize = new ResizeObserver(update);
	const theme = new MutationObserver(update);
	resize.observe(header);
	const attributes = {
		attributes: true,
		attributeFilter: ["class", "style"],
	};
	theme.observe(document.documentElement, attributes);
	theme.observe(header, attributes);
	scheme.addEventListener("change", update);
	update();
	return () => {
		resize.disconnect();
		theme.disconnect();
		scheme.removeEventListener("change", update);
	};
}
