import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function SSHIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Open Terminal" {...props}>
			{!props.nobox && <Box size={s} />}
			<polyline
				points={points([
					[scale(20), scale(44)],
					[scale(28), scale(36)],
					[scale(20), scale(28)],
				])}
			/>
			<polyline
				points={points([
					[scale(44), scale(20)],
					[scale(36), scale(28)],
					[scale(44), scale(36)],
				])}
			/>
		</Svg>
	);
}
