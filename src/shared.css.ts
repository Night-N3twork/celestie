import { style } from "@vanilla-extract/css";
import { vars } from "#theme.css";

export const row = style({ display: "flex", minWidth: 0 });
export const column = style({
	display: "flex",
	flexDirection: "column",
	minWidth: 0,
	minHeight: 0,
});
export const fill = style({ flex: 1, minWidth: 0, minHeight: 0 });
export const center = style({
	justifyContent: "center",
	alignItems: "center",
});

export const buttonBase = style({
	border: 0,
	background: "transparent",
	font: "inherit",
	flexShrink: 0,
	cursor: "pointer",
});

export const focusable = style({
	":focus-visible": {
		outline: `2px solid ${vars.color.blue}`,
		outlineOffset: "-2px",
	},
});
