import { globalStyle, style } from "@vanilla-extract/css";
import { buttonBase, focusable } from "#shared.css";
import { vars } from "#theme.css";

export const main = style([
	buttonBase,
	focusable,
	{
		borderRadius: "6px",
		padding: "2px 8px",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		gap: "6px",
		fontSize: "12px",
		lineHeight: 1,
		whiteSpace: "nowrap",
		color: vars.color.text,
		selectors: {
			"&:hover:not(:disabled)": { backgroundColor: vars.color.surface1 },
			"&:active:not(:disabled)": { backgroundColor: vars.color.surface2 },
			'&[aria-pressed="true"]': { backgroundColor: vars.color.surface0 },
		},
		":disabled": { cursor: "default", opacity: 0.45 },
	},
]);

globalStyle(`${main} > svg`, {
	width: "100%",
	height: "100%",
	flexShrink: 0,
});

const sizes = { sm: 24, md: 36, lg: 48 };
export const size = Object.fromEntries(
	Object.entries(sizes).map(([key, value]) => [
		key,
		style({ width: value, height: value }),
	]),
) as Record<keyof typeof sizes, string>;

export const svg = style({ padding: "2px" });
export const text = style({ width: "auto", padding: "2px 8px" });
globalStyle(`${text} > svg`, { width: "1.25em", height: "1.25em" });
export const full = style({ width: "100%" });
