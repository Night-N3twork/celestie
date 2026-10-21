import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function CommitIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Commit" {...props}>
			{!props.nobox && <Box size={s} />}
			<circle cx={s / 2} cy={s / 2} r={scale(4)} />
			<path
				d={path([
					["M", scale(32), scale(18)],
					["L", scale(32), scale(28)],
					["M", scale(32), scale(36)],
					["L", scale(32), scale(46)],
				])}
			/>
		</Svg>
	);
}
