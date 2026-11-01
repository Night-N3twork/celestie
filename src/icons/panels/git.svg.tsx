import { points, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";
import { createUniqueId } from "solid-js";

export default function GitIcon(props: SVGProps) {
	const s = props.size;
	const id = createUniqueId();
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Open Git" {...props}>
			{!props.nobox && <Box size={s} />}
			<circle cx={scale(42)} cy={scale(22)} r={scale(4)} />
			<circle cx={scale(22)} cy={scale(22)} r={scale(4)} />
			<circle cx={scale(22)} cy={scale(42)} r={scale(4)} />
			<mask
				id={id}
				maskUnits="userSpaceOnUse"
				x={0}
				y={0}
				width={s}
				height={s}
			>
				<rect
					fill="white"
					stroke="none"
					x={scale(36)}
					y={scale(30)}
					width={scale(6) + scale(8 / 3)}
					height={scale(6) + scale(8 / 3)}
				/>
			</mask>
			<g stroke-linecap="square" stroke-linejoin="miter">
				<polyline
					points={points([
						[scale(22), scale(28)],
						[scale(22), scale(36)],
						[scale(34), scale(36)],
					])}
				/>
				<polyline
					points={points([
						[scale(42), scale(28)],
						[scale(42), scale(28)],
					])}
				/>
			</g>
			<circle
				mask={`url(#${id})`}
				cx={scale(36)}
				cy={scale(30)}
				r={scale(6)}
			/>
		</Svg>
	);
}
