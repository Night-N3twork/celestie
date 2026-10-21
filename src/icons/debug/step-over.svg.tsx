import { path, points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function StepOverIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	const circle = (a: number): { x: number; y: number } => ({
		x: s / 2 + scale(12) * Math.cos((Math.PI * a) / 180),
		y: s / 2 - scale(12) * Math.sin((Math.PI * a) / 180),
	});
	return (
		<Svg title="Step Over" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				transform={`translate(0,${scale(4)})`}
				d={path([
					["M", circle(165).x, circle(165).y],
					[
						"A",
						scale(12),
						scale(12),
						0,
						0,
						1,
						circle(15).x,
						circle(15).y,
					],
				])}
			/>
			<polyline
				transform={`rotate(${-15},${s / 2},${s / 2}) translate(${-scale(1)},${scale(4)})`}
				points={points([
					[
						scale(44) - Math.sqrt(scale(50)),
						s / 2 - Math.sqrt(scale(50)),
					],
					[scale(44), s / 2],
					[
						scale(44) + Math.sqrt(scale(50)),
						s / 2 - Math.sqrt(scale(50)),
					],
				])}
			/>
			<circle cx={s / 2} cy={scale(36)} r={scale(2)} />
		</Svg>
	);
}
