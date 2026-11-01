import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function RemoveIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Remove" {...props}>
			{!props.nobox && <Box size={s} />}
			<path d={`M ${(s * 5) / 16} ${s / 2} H ${(s * 11) / 16}`} />
		</Svg>
	);
}
