import type { SVGProps } from "@icons/icons";
import Svg, { Box } from "@icons/Svg";
import AddIcon from "./add.svg";

export default function CloseIcon(props: SVGProps) {
	const s = props.size;
	return (
		<Svg title="Close" {...props}>
			{!props.nobox && <Box size={s} />}
			<AddIcon nobox rotate={45} size={s} />
		</Svg>
	);
}
