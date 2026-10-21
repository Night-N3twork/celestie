import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function DebugIcon(props: SVGProps) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Open Terminal" {...props}>
			{!props.nobox && <Box size={s} />}
			<mask
				id="head"
				maskUnits="userSpaceOnUse"
				x={0}
				y={0}
				width={s}
				height={s}
			>
				<Box size={s} fill="white" />
				<circle
					fill="black"
					stroke="black"
					cx={s / 2}
					cy={scale(36)}
					r={scale(32 / 3)}
				/>
			</mask>
			<circle cx={s / 2} cy={scale(36)} r={scale(32 / 3)} />
			<g mask="url(#head)">
				<circle cx={s / 2} cy={scale(24)} r={scale(32 / 5)} />
				<polyline
					points={points([
						[scale(20), scale(24)],
						[s / 2, scale(128 / 3)],
						[scale(44), scale(24)],
					])}
				/>
				<polyline
					points={points([
						[scale(16), scale(36)],
						[s / 2, s / 2],
						[scale(48), scale(36)],
					])}
				/>
				<polyline
					points={points([
						[scale(20), scale(44)],
						[s / 2, s / 2],
						[scale(44), scale(44)],
					])}
				/>
			</g>
		</Svg>
	);
}
