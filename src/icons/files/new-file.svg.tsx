import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function NewFileIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="New File" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={path([
					["M", s / 2, scale(18)],
					["L", scale(24), scale(18)],
					["A", scale(4), scale(4), 0, 0, 0, scale(20), scale(22)],
					["L", scale(20), scale(42)],
					["A", scale(4), scale(4), 0, 0, 0, scale(24), scale(46)],
					["L", scale(32), scale(46)],
					["M", scale(44), scale(34)],
					["L", scale(44), scale(30)],
					[
						"A",
						scale(4),
						scale(4),
						0,
						0,
						0,
						scale(40) + scale(4) * Math.cos(Math.PI / 4),
						scale(30) - scale(4) * Math.sin(Math.PI / 4),
					],
					[
						"L",
						s / 2 + scale(4) * Math.cos(Math.PI / 4),
						scale(22) - scale(4) * Math.sin(Math.PI / 4),
					],
					["A", scale(4), scale(4), 0, 0, 0, s / 2, scale(18)],
					["L", s / 2, scale(26)],
					["A", scale(4), scale(4), 0, 0, 0, scale(36), scale(30)],
					["L", scale(44), scale(30)],
				])}
			/>
			<path
				d={path([
					["M", scale(38), scale(44)],
					["L", scale(46), scale(44)],
					["M", scale(42), scale(40)],
					["L", scale(42), scale(48)],
				])}
			/>
		</Svg>
	);
}
