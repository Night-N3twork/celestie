import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function MergeIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Merge" {...props}>
			{!props.nobox && <Box size={s} />}
			<circle cx={scale(22)} cy={scale(22)} r={scale(4)} />
			<circle cx={scale(22)} cy={scale(42)} r={scale(4)} />
			<circle cx={scale(42)} cy={scale(42)} r={scale(4)} />
			<path
				d={path([
					["M", scale(22), scale(26)],
					["L", scale(22), scale(38)],
					["M", scale(42), scale(38)],
					["L", scale(42), scale(26)],
					["A", scale(4), scale(4), 0, 0, 0, scale(38), scale(22)],
					["L", scale(26), scale(22)],
				])}
			/>
		</Svg>
	);
}
