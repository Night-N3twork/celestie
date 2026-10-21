import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function TerminalIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Open Terminal" {...props}>
			{!props.nobox && <Box size={s} />}
			<polyline
				points={points([
					[scale(20), scale(24)],
					[scale(28), s / 2],
					[scale(20), scale(40)],
				])}
			/>
			<line x1={scale(36)} y1={scale(40)} x2={scale(44)} y2={scale(40)} />
		</Svg>
	);
}
