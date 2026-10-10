import { style } from "@vanilla-extract/css";
import { fill, row } from "#shared.css";
import { vars } from "#theme.css";

export const main = style([
	row,
	{
		flexDirection: "row",
		width: "100%",
		height: "32px",
		flexShrink: 0,
		backgroundColor: vars.color.crust,
	},
]);

export const vertical = style({
	flexDirection: "column",
	width: "32px",
	padding: 0,
	height: "100%",
});

export const section = style([
	row,
	{
		flexDirection: "inherit",
		alignItems: "center",
		padding: "4px",
		gap: "2px",
	},
]);

export const start = style([fill, { justifyContent: "flex-start" }]);

export const middle = style({
	justifyContent: "center",
});

export const end = style([fill, { justifyContent: "flex-end" }]);
