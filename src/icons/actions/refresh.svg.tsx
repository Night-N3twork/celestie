import { path, points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function RefreshIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	const arrowOffset = scale(Math.sqrt(50));
	const circle = (a: number): { x: number; y: number } => ({
		x: s / 2 + scale(12) * Math.cos((Math.PI * a) / 180),
		y: s / 2 - scale(12) * Math.sin((Math.PI * a) / 180),
	});
	return (
		<Svg title="Refresh" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={path([
					["M", circle(-15).x, circle(-15).y],
					[
						"A",
						scale(12),
						scale(12),
						0,
						1,
						1,
						circle(15).x,
						circle(15).y,
					],
				])}
			/>
			<polyline
				transform={`rotate(${-15},${s / 2},${s / 2})`}
				points={points([
					[scale(44) - arrowOffset, s / 2 - arrowOffset],
					[scale(44), s / 2],
					[scale(44) + arrowOffset, s / 2 - arrowOffset],
				])}
			/>
		</Svg>
	);
}
