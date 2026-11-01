import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function RefreshIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Refresh" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={`M ${scale(48)} ${scale(28)} A ${scale(16)} ${scale(16)} 0 1 0 ${scale(43.3)} ${scale(43.3)}`}
			/>
			<path
				d={`M ${scale(38)} ${scale(28)} H ${scale(48)} V ${scale(18)}`}
			/>
		</Svg>
	);
}
