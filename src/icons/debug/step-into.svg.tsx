import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function StepIntoIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Step Into" {...props}>
			{!props.nobox && <Box size={s} />}
			<line x1={s / 2} x2={s / 2} y1={(9 * s) / 32} y2={(19 * s) / 32} />
			<polyline
				transform={`rotate(45,${s / 2},${(19 * s) / 32})`}
				points={points([
					[s / 2, scale(26)],
					[s / 2, (19 * s) / 32],
					[scale(20), (19 * s) / 32],
				])}
			/>
			<polyline
				points={points([
					[(5 * s) / 16, (11 * s) / 16],
					[(11 * s) / 16, (11 * s) / 16],
				])}
			/>
		</Svg>
	);
}
