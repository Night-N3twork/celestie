import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function SearchIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	const radius = 32 / 3;
	const handleOffset = radius / Math.SQRT2;
	return (
		<Svg title="Search" {...props}>
			{!props.nobox && <Box size={s} />}
			<circle cx={scale(36)} cy={scale(28)} r={scale(radius)} />
			<line
				x1={scale(36 - handleOffset)}
				x2={scale(18)}
				y1={scale(28 + handleOffset)}
				y2={scale(46)}
			/>
		</Svg>
	);
}
