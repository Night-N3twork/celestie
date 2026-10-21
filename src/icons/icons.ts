import type { JSX } from "solid-js";

type Props = JSX.SvgSVGAttributes<SVGSVGElement>;
export type SVGProps = Props & {
	size: number;
	title?: string;
	nobox?: boolean;
};

export function points(points: number[][]) {
	return points.map((point) => point.join(",")).join(" ");
}

export function path(commands: readonly (number | string)[][]) {
	return commands.map((command) => command.join(" ")).join(" ");
}
