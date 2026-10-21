import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function NewFolderIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="New Folder" {...props}>
			{!props.nobox && <Box size={s} />}
			<path
				d={path([
					["M", scale(16), scale(23)],
					["L", scale(16), scale(41)],
					["A", scale(4), scale(4), 0, 0, 0, scale(20), scale(45)],
					["L", scale(36), scale(45)],
					["M", scale(48), scale(32)],
					["L", scale(48), scale(24)],
					["A", scale(4), scale(4), 0, 0, 0, scale(44), scale(20)],
					["L", scale(32), scale(20)],
					["M", scale(48), scale(29)],
					["A", scale(4), scale(4), 0, 0, 0, scale(44), scale(25)],
					["L", scale(32), scale(25)],
					["L", scale(32), scale(23)],
					["A", scale(4), scale(4), 0, 0, 0, scale(28), scale(19)],
					["L", scale(20), scale(19)],
					["A", scale(4), scale(4), 0, 0, 0, scale(16), scale(23)],
				])}
			/>
			<path
				d={path([
					["M", scale(42), scale(43)],
					["L", scale(50), scale(43)],
					["M", scale(46), scale(39)],
					["L", scale(46), scale(47)],
				])}
			/>
		</Svg>
	);
}
