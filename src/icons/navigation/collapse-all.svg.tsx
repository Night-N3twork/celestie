import { path, type SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";
import { createUniqueId } from "solid-js";

export default function CollapseAllIcon(props: SVGProps) {
	const s = props.size;
	const id = createUniqueId();
	const scale = (value: number) => (value * s) / 64;
	return (
		<Svg title="Collapse All" {...props}>
			{!props.nobox && <Box size={s} />}
			<defs>
				<path
					id={id}
					d={path([
						["M", scale(21), scale(25)],
						[
							"A",
							scale(4),
							scale(4),
							0,
							0,
							1,
							scale(25),
							scale(21),
						],
						["L", scale(39), scale(21)],
						[
							"A",
							scale(4),
							scale(4),
							0,
							0,
							1,
							scale(43),
							scale(25),
						],
						["L", scale(43), scale(39)],
						[
							"A",
							scale(4),
							scale(4),
							0,
							0,
							1,
							scale(39),
							scale(43),
						],
					])}
				/>
			</defs>
			<rect
				x={scale(16)}
				y={scale(26)}
				width={scale(22)}
				height={scale(22)}
				rx={s / 16}
			/>
			<use href={`#${id}`} />
			<use
				href={`#${id}`}
				transform={`translate(${scale(5)},${-scale(5)})`}
			/>
			<path
				d={path([
					["M", scale(24), scale(37)],
					["L", scale(30), scale(37)],
				])}
			/>
		</Svg>
	);
}
