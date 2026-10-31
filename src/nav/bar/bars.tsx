import type { JSXElement } from "solid-js";

export type Bar = {
	show: boolean;
	align: "horizontal" | "vertical";
	components: {
		start?: JSXElement[];
		middle?: JSXElement[];
		end?: JSXElement[];
	};
};

export const bars: Record<string, Bar> = {
	top: {
		show: true,
		align: "horizontal",
		components: {
		},
	},
	bottom: {
		show: true,
		align: "horizontal",
		components: {},
	},
	left: {
		show: true,
		align: "vertical",
		components: {},
	},
	right: {
		show: false,
		align: "vertical",
		components: {},
	},
};
