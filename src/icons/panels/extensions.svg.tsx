import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function ExtensionsIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;

	return (
		<Svg title="Extensions" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={path([
					["M", scale(18), scale(26)],
					["H", scale(28)],
					["V", scale(36)],
					["H", scale(38)],
					["V", scale(46)],
					["H", scale(18)],
					["Z"],
					["M", scale(18), scale(36)],
					["H", scale(28)],
					["V", scale(46)],
				])}
			/>
			<rect
				x={scale(36)}
				y={scale(18)}
				width={scale(10)}
				height={scale(10)}
			/>
		</Svg>
	);
}
