import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "#theme.css";

export const main = style({
	position: "relative",
	display: "inline-flex",
	flexShrink: 0,
});

const horizontal = ':is([data-side="top"], [data-side="bottom"])';
const vertical = ':is([data-side="left"], [data-side="right"])';

export const tip = style({
	position: "absolute",
	zIndex: 10,
	top: "calc(100% + 4px)",
	left: "50%",
	transform: "translateX(-50%)",
	padding: "4px 8px",
	borderRadius: "4px",
	whiteSpace: "nowrap",
	fontSize: "12px",
	lineHeight: 1.4,
	boxShadow: "0 2px 8px #0004",
	pointerEvents: "none",
	color: vars.color.text,
	backgroundColor: vars.color.surface0,
	opacity: 0,
	visibility: "hidden",
	transition: "opacity 0.1s",
	selectors: {
		[`${main}:is(:hover, :focus-within) > &`]: {
			opacity: 1,
			visibility: "visible",
			transitionDelay: "0.4s",
		},
		[`[data-side="bottom"] ${main} > &`]: {
			top: "auto",
			bottom: "calc(100% + 4px)",
		},
		[`[data-side="left"] ${main} > &`]: {
			top: "50%",
			left: "calc(100% + 4px)",
			transform: "translateY(-50%)",
		},
		[`[data-side="right"] ${main} > &`]: {
			top: "50%",
			left: "auto",
			right: "calc(100% + 4px)",
			transform: "translateY(-50%)",
		},
		[`${horizontal} [data-pos="start"] ${main} > &`]: {
			left: 0,
			transform: "none",
		},
		[`${horizontal} [data-pos="end"] ${main} > &`]: {
			left: "auto",
			right: 0,
			transform: "none",
		},
		[`${vertical} [data-pos="start"] ${main} > &`]: {
			top: 0,
			transform: "none",
		},
		[`${vertical} [data-pos="end"] ${main} > &`]: {
			top: "auto",
			bottom: 0,
			transform: "none",
		},
	},
});

export const shortcut = style({
	marginLeft: "8px",
	color: vars.color.subtext0,
});

globalStyle(`${tip} kbd`, {
	fontFamily: "inherit",
});
