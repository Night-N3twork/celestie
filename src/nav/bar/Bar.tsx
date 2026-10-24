import { Show } from "solid-js/web";
import { bars } from "./bars";
import "@style/nav/bar.scss";

type Without<T> = { [P in keyof T]?: never };

type Directions = {
	top: boolean;
	bottom: boolean;
	left: boolean;
	right: boolean;
};

type DirectionName = keyof Directions;

type BarProps = {
	[K in DirectionName]: Pick<Directions, K> & Without<Omit<Directions, K>>;
}[DirectionName];

export default function Bar(props: BarProps) {
	const direction = Object.keys(props).find(
		(key) => props[key as DirectionName] === true,
	) as DirectionName;
	return (
		<Show
			when={
				bars[direction].show &&
				(["start", "middle", "end"] as const).some(
					(key) => (bars[direction].components[key]?.length ?? 0) > 0,
				)
			}
		>
			<div class={`bar ${bars[direction].align}`}>
				{(["start", "middle", "end"] as const).map((dir) => (
					<div class={dir}>{bars[direction].components[dir]}</div>
				))}
			</div>
		</Show>
	);
}
