import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function SplitEditorIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Split editor" {...props}>
			{!props.nobox && <Box size={s} />}
			<rect
				x={s / 4}
				y={s / 4}
				width={s / 2}
				height={s / 2}
				rx={s / 16}
			/>
			<path d={`M ${s / 2} ${s / 4} V ${(s * 3) / 4}`} />
		</Svg>
	);
}
