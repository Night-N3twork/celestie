import { globalStyle, style } from "@vanilla-extract/css";
import { fill, row as rowBase } from "#shared.css";
import { vars } from "#theme.css";

globalStyle("*, *::before, *::after", { boxSizing: "border-box" });
globalStyle("body", { margin: 0 });
globalStyle("html, body, #root", { width: "100%", height: "100%" });
globalStyle("body", {
	backgroundColor: vars.color.crust,
	color: vars.color.text,
	fontFamily: '"JetBrains Mono", ui-monospace, monospace',
	fontSize: "14px",
	lineHeight: 1.5,
});
globalStyle("#root", {
	display: "flex",
	flexDirection: "column",
	height: "100dvh",
	overflow: "hidden",
});

export const row = style([
	rowBase,
	{
		width: "100%",
		flexDirection: "row",
		alignItems: "stretch",
		flexShrink: 0,
	},
]);
export const main = style([fill, { flexShrink: 1 }]);
