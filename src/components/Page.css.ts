import { style } from "@vanilla-extract/css";
import { center, fill, row } from "#shared.css";
import { vars } from "#theme.css";

export const main = style([
	row,
	center,
	fill,
	{
		backgroundColor: vars.color.base,
		overflow: "auto",
	},
]);
