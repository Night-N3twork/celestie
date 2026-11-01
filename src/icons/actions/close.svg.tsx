import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function CloseIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Close" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={`M ${s * 0.34} ${s * 0.34} L ${s * 0.66} ${s * 0.66} M ${s * 0.66} ${s * 0.34} L ${s * 0.34} ${s * 0.66}`}
			/>
		</Svg>
	);
}
