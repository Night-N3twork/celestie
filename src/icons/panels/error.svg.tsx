import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export function Angle(props: {
	size: number;
	top: number;
	bottom: number;
	rotate: number;
	center?: { x: number; y: number };
}) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	const radius = scale(2);
	const x = (Math.sqrt(3) * radius) / 2;
	const y = (3 * radius) / 2;
	return (
		<path
			transform={`rotate(${props.rotate}, ${props.center?.x ?? s / 2}, ${props.center?.y ?? (props.top + 2 * props.bottom) / 3})`}
			d={path([
				["M", s / 2 - x, props.top + y],
				["A", radius, radius, 0, 0, 1, s / 2 + x, props.top + y],
				["L", scale(48) - x, props.bottom - y],
			])}
		/>
	);
}

export default function ErrorIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	const height = Math.sqrt(3) * scale(16);
	const corner = (Math.sqrt(3) * scale(4)) / 2;
	const top = (s - height) / 2 - corner / 4;
	const bottom = (s + height) / 2 - corner / 4;
	const center = { x: s / 2, y: (top + 2 * bottom) / 3 };
	return (
		<Svg title="Open Error Menu" {...props}>
			{!props.nobox && <Box size={s} />}
			<Angle
				size={s}
				top={top}
				bottom={bottom}
				center={center}
				rotate={0}
			/>
			<Angle
				size={s}
				top={top}
				bottom={bottom}
				center={center}
				rotate={120}
			/>
			<Angle
				size={s}
				top={top}
				bottom={bottom}
				center={center}
				rotate={240}
			/>
			<line
				x1={s / 2}
				y1={scale(28) - corner / 4}
				x2={s / 2}
				y2={scale(34) - corner / 4}
			/>
			<line
				x1={s / 2}
				y1={scale(40) - corner / 4}
				x2={s / 2}
				y2={scale(40) - corner / 4}
			/>
		</Svg>
	);
}
