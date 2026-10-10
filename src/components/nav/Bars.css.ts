import { style } from "@vanilla-extract/css";
import { vars } from "#theme.css";

export const main = style({
	display: "flex",
	flexDirection: "row",
	width: "100%",
	height: "32px",
	flexShrink: 0,
	minWidth: 0,
	backgroundColor: vars.color.crust,
});

export const vertical = style({
	flexDirection: "column",
	width: "32px",
	padding: 0,
	height: "100%",
});

export const section = style({
	display: "flex",
	flexDirection: "inherit",
	alignItems: "center",
	padding: "4px",
	gap: "2px",
});

export const start = style({
	flex: 1,
	justifyContent: "flex-start",
	minWidth: 0,
});

export const middle = style({
	justifyContent: "center",
});

export const end = style({
	flex: 1,
	justifyContent: "flex-end",
});
