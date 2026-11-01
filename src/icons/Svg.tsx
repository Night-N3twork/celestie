import { type JSX, splitProps } from "solid-js";
import { path, type SVGProps } from "./icons";

export default function Svg(props: SVGProps) {
	const [, svgProps] = splitProps(props, ["nobox"]);
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={props.size}
			height={props.size}
			viewBox={
				props.nobox
					? `${props.size / 8} ${props.size / 8} ${(props.size * 3) / 4} ${(props.size * 3) / 4}`
					: `0 0 ${props.size} ${props.size}`
			}
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width={props.size / 16}
			{...svgProps}
		>
			<title>{props.title}</title>
			{props.children}
		</svg>
	);
}

export function Box(
	props: JSX.SvgSVGAttributes<SVGRectElement> & {
		size: number;
	},
) {
	return (
		<rect
			x={props.size / 8}
			y={props.size / 8}
			width={(3 * props.size) / 4}
			height={(3 * props.size) / 4}
			rx={props.size / 8}
			ry={props.size / 8}
			{...props}
		/>
	);
}

export function Angle(
	props: JSX.SvgSVGAttributes<SVGPathElement> & {
		size: number;
		rotate: number;
	},
) {
	const s = props.size;
	const r = s / 32;
	const s3 = Math.sqrt(3);
	const transform = () => {
		const cr = {
			dist:
				s / 2 -
				(r * s3) / 6 +
				(5 * r * s3) / 4 -
				(s / 2 - (r * s3) / 6 + (r * (18 - 49 * s3)) / 12 + r / 2),
			x: [0],
			y: [0],
		};
		const corners = [0, 120, 240].map((angle) => {
			const radians = ((props.rotate + angle) * Math.PI) / 180;
			return {
				x: cr.dist * Math.sin(radians),
				y: -cr.dist * Math.cos(radians),
			};
		});
		cr.x = corners.map((corner) => corner.x);
		cr.y = corners.map((corner) => corner.y);
		const ox = -(Math.min(...cr.x) + Math.max(...cr.x)) / 2;
		const oy =
			s / 2 -
			r / 2 -
			(s / 2 - (r * s3) / 6 + (5 * r * s3) / 4) -
			(Math.min(...cr.y) + Math.max(...cr.y)) / 2;
		return `translate(${ox}, ${oy}) rotate(${props.rotate}, ${s / 2}, ${s / 2 - (r * s3) / 6 + (5 * r * s3) / 4})`;
	};
	return (
		<path
			transform={transform()}
			d={path([
				[
					"M",
					s / 2 - 4 * r,
					s / 2 -
						(r * s3) / 6 +
						(r * (18 - 49 * s3)) / 12 +
						(r * (8 * s3 - 3)) / 2,
				],
				[
					"L",
					s / 2 - (r * s3) / 2,
					s / 2 - (r * s3) / 6 + (r * (18 - 49 * s3)) / 12,
				],
				[
					"A",
					r,
					r,
					0,
					0,
					1,
					s / 2 + (r * s3) / 2,
					s / 2 - (r * s3) / 6 + (r * (18 - 49 * s3)) / 12,
				],
				[
					"L",
					s / 2 + 4 * r,
					s / 2 -
						(r * s3) / 6 +
						(r * (18 - 49 * s3)) / 12 +
						(r * (8 * s3 - 3)) / 2,
				],
			])}
			{...props}
		/>
	);
}
