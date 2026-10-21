import type { SVGProps } from "@icons/icons";
import Svg, { Angle, Box } from "@icons/Svg";

export default function RunIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Run" {...props}>
			{!props.nobox && <Box size={s} />}
			<g transform={`translate(0, ${s / 64})`}>
				<Angle size={s} rotate={90} />
				<Angle size={s} rotate={210} />
				<Angle size={s} rotate={330} />
			</g>
		</Svg>
	);
}
