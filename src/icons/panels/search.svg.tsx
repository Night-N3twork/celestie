import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function SearchIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Search" {...props}>
			{!props.nobox && <Box size={s} />}
			<defs>
				<circle
					id="glass"
					cx={scale(36)}
					cy={scale(28)}
					r={scale(32 / 3)}
				/>
			</defs>
			<mask
				id="mask"
				maskUnits="userSpaceOnUse"
				x={0}
				y={0}
				width={s}
				height={s}
			>
				<rect x={0} y={0} width={s} height={s} fill="white" />
				<use fill="black" href="#glass" />
			</mask>
			<use href="#glass" />
			<line
				mask="url(#mask)"
				x1={scale(36)}
				x2={scale(18)}
				y1={scale(28)}
				y2={scale(46)}
			/>
		</Svg>
	);
}
