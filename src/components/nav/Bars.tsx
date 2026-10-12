import { For, Show } from "solid-js";
import bars from "./Bars.json";
import Button from "./Button";
import items, { type ItemName } from "./barItems";

type Side = keyof typeof bars;
type Position = keyof (typeof bars)[Side];
interface BarOptions {
	vertical?: boolean;
	id: "t" | "b" | "l" | "r";
	onNew?: () => void;
}
const sides: Record<BarOptions["id"], Side> = {
	t: "top",
	b: "bottom",
	l: "left",
	r: "right",
};
function resolveItems(names: string[]): ItemName[] {
	return names.map((name) => {
		if (!Object.hasOwn(items, name))
			throw new Error(`Unknown toolbar item: ${name}`);
		return name as ItemName;
	});
}
const positions: Position[] = ["start", "middle", "end"];

export default function Bar(props: BarOptions) {
	const bar = () => bars[sides[props.id]];
	const populated = () => positions.some((pos) => bar()[pos].length > 0);
	return (
		<Show when={populated()}>
			<nav
				aria-label={`${sides[props.id]} toolbar`}
				data-side={sides[props.id]}
				class="bar"
				classList={{ "bar-vertical": props.vertical }}
			>
				<For each={positions}>
					{(pos) => (
						<div data-pos={pos} class={`bar-section bar-${pos}`}>
							<For each={resolveItems(bar()[pos])}>
								{(name) => (
									<Button
										{...items[name]}
										onClick={
											name === "new"
												? props.onNew
												: undefined
										}
									/>
								)}
							</For>
						</div>
					)}
				</For>
			</nav>
		</Show>
	);
}
