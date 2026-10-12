import type { JSX } from "solid-js";

type SVGProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
	size?: number;
};

export function Close(props: SVGProps) {
	const size = props.size ?? 24;
	return (
		<svg
			stroke="currentColor"
			stroke-width={size / 8}
			stroke-linecap="round"
			xmlns="http://www.w3.org/2000/svg"
			width={props.size ?? 24}
			height={props.size ?? 24}
			viewBox={`0 0 ${size} ${size}`}
			{...props}
		>
			<title>Close</title>
			<line
				x1={size / 8}
				y1={size / 8}
				x2={(7 * size) / 8}
				y2={(7 * size) / 8}
			/>
			<line
				x1={size / 8}
				y1={(7 * size) / 8}
				x2={(7 * size) / 8}
				y2={size / 8}
			/>
		</svg>
	);
}

export function Plus(props: SVGProps) {
	const size = props.size ?? 24;
	return (
		<svg
			stroke="currentColor"
			stroke-width={size / 8}
			stroke-linecap="round"
			xmlns="http://www.w3.org/2000/svg"
			width={size ?? 24}
			height={size ?? 24}
			viewBox={`0 0 ${size} ${size}`}
			{...props}
		>
			<title>Plus</title>
			<line
				x1={size / 2}
				y1={size / 8}
				x2={size / 2}
				y2={(7 * size) / 8}
			/>
			<line
				x1={size / 8}
				y1={size / 2}
				x2={(7 * size) / 8}
				y2={size / 2}
			/>
		</svg>
	);
}
