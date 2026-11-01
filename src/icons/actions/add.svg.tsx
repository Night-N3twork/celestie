import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";

export default function AddIcon(props: SVGProps & { rotate?: number }) {
	const s = props.size;
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Add" {...props}>
			{!props.nobox && <Box size={s} />}
			<line
				transform={`rotate(${props.rotate ?? 0},${s / 2},${s / 2})`}
				x1={scale(20)}
				y1={s / 2}
				x2={scale(44)}
				y2={s / 2}
			/>
			<line
				transform={`rotate(${props.rotate ?? 0},${s / 2},${s / 2})`}
				y1={scale(20)}
				x1={s / 2}
				y2={scale(44)}
				x2={s / 2}
			/>
		</Svg>
	);
}
