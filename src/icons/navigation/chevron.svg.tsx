import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function ChevronDownIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Chevron" {...props}>
			{!props.nobox && <Box size={s} />}
			<polyline
				points={points([
					[scale(24), scale(20)],
					[scale(40), scale(32)],
					[scale(24), scale(44)],
				])}
			/>
		</Svg>
	);
}
