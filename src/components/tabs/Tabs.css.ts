import { style } from "@vanilla-extract/css";
import { buttonBase, column, fill, focusable, row } from "#shared.css";
import { vars } from "#theme.css";

export const workspace = style([
	column,
	fill,
	{ backgroundColor: vars.color.base },
]);

export const bar = style([
	row,
	{
		position: "relative",
		flexShrink: 0,
		backgroundColor: vars.color.crust,
		overflow: "hidden",
		selectors: {
			'&[data-dragging="true"]': {
				cursor: "grabbing",
				userSelect: "none",
			},
		},
	},
]);

export const list = style([
	row,
	{
		position: "relative",
		flex: 1,
		overflowX: "auto",
		overflowY: "clip",
		scrollbarWidth: "none",
		scrollbarColor: "transparent transparent",
		selectors: {
			"&::-webkit-scrollbar": { display: "none" },
		},
	},
]);

export const track = style({
	position: "absolute",
	bottom: "0px",
	left: 0,
	height: "4px",
	zIndex: 4,
	pointerEvents: "none",
	opacity: 0,
	transition: "opacity 150ms ease",
	"@media": {
		"(prefers-reduced-motion: reduce)": { transition: "none" },
	},
	selectors: {
		'&[data-show="true"]': { opacity: 1 },
	},
});

export const thumb = style({
	position: "absolute",
	top: "0",
	height: "4px",
	minWidth: "24px",
	borderRadius: "8px",
	backgroundClip: "padding-box",
	backgroundColor: `color-mix(in srgb, ${vars.color.surface2} 65%, transparent)`,
	pointerEvents: "auto",
	cursor: "grab",
	selectors: {
		"&:hover": { backgroundColor: vars.color.overlay0 },
		"&:active": { cursor: "grabbing" },
		'&[data-show="false"]': { visibility: "hidden" },
	},
});

export const tab = style([
	row,
	{
		position: "relative",
		color: vars.color.subtext0,
		alignItems: "center",
		flexShrink: 0,
		maxWidth: "240px",
		cursor: "grab",
		":hover": {
			backgroundColor: vars.color.mantle,
			color: vars.color.text,
		},
		selectors: {
			'&[data-preview="true"]': { cursor: "grabbing" },
			'&[data-preview="true"]:not([data-dragging="true"])': {
				transition: "transform 140ms ease",
				"@media": {
					"(prefers-reduced-motion: reduce)": { transition: "none" },
				},
			},
			'&[data-active="true"]': {
				backgroundColor: vars.color.base,
				borderTopColor: vars.color.blue,
			},
			'&[data-dragging="true"]': {
				zIndex: 2,
				backgroundColor: vars.color.surface0,
				pointerEvents: "none",
				cursor: "grabbing",
			},
		},
	},
]);

export const insertionLine = style({
	position: "absolute",
	top: "3px",
	bottom: "3px",
	width: "2px",
	transform: "translateX(-1px)",
	backgroundColor: vars.color.blue,
	borderRadius: "1px",
	zIndex: 3,
	pointerEvents: "none",
});

const button = style([
	buttonBase,
	focusable,
	{
		color: vars.color.subtext0,
		":hover": {
			backgroundColor: vars.color.surface0,
			color: vars.color.text,
		},
	},
]);

export const select = style([
	buttonBase,
	focusable,
	{
		color: "inherit",
		padding: "8px 12px",
		minWidth: 0,
		flexShrink: 1,
		textAlign: "left",
		fontSize: "12px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
		touchAction: "none",
		userSelect: "none",
		cursor: "inherit",
		selectors: { '&[aria-selected="true"]': { color: vars.color.text } },
	},
]);

export const close = style([
	button,
	{ width: "24px", height: "24px", marginRight: "4px", borderRadius: "4px" },
]);

export const add = style([
	button,
	{ width: "36px", minHeight: "36px", fontSize: "20px" },
]);

export const panel = style([
	focusable,
	{
		display: "flex",
		flex: 1,
		minWidth: 0,
		minHeight: 0,
	},
]);
