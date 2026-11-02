import type { JSX } from "solid-js";

export type SVGProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
	size: number;
	title?: string;
};

export function points(points: number[][]) {
	return points.map((point) => point.join(",")).join(" ");
}

export function path(commands: readonly (number | string)[][]) {
	return commands.map((command) => command.join(" ")).join(" ");
}
