import { style } from "@vanilla-extract/css";
import { vars } from "#theme.css";

export const main = style({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	flex: 1,
	minWidth: 0,
	minHeight: 0,
	backgroundColor: vars.color.base,
	overflow: "auto",
});
