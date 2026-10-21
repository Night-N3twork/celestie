import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function StopIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Stop" {...props}>
			{!props.nobox && <Box size={s} />}
			<rect
				x={(9 * s) / 32}
				y={(9 * s) / 32}
				width={(7 * s) / 16}
				height={(7 * s) / 16}
				rx={props.size / 8}
				ry={props.size / 8}
			/>
		</Svg>
	);
}
