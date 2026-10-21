import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function MoreIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="More" {...props}>
			{!props.nobox && <Box size={s} />}
			{[20, 32, 44].map((x) => (
				<circle cx={scale(x)} cy={s / 2} r={scale(2)} />
			))}
		</Svg>
	);
}
