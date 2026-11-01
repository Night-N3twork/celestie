import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";
import { createUniqueId } from "solid-js";

export default function DiffIcon(props: SVGProps) {
	const s = props.size;
	const id = createUniqueId();
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Diff" {...props}>
			{!props.nobox && <Box size={s} />}
			<defs>
				<g id={id}>
					<circle cx={scale(22)} cy={scale(22)} r={scale(4)} />
					<path
						d={path([
							["M", scale(22), scale(26)],
							["L", scale(22), scale(38)],
							["L", scale(30), scale(46)],
							["L", scale(24), scale(46)],
							["M", scale(30), scale(46)],
							["L", scale(30), scale(40)],
						])}
					/>
				</g>
			</defs>
			<use href={`#${id}`} />
			<use href={`#${id}`} transform={`rotate(180,${s / 2},${s / 2})`} />
		</Svg>
	);
}
