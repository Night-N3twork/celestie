import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function BreakpointIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Breakpoint" {...props}>
			{!props.nobox && <Box size={s} />}
			<circle cx={s / 2} cy={s / 2} r={scale(12)} fill="currentColor" />
		</Svg>
	);
}
