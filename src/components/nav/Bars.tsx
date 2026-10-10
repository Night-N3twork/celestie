import { For, Show } from "solid-js";
import { end, main, middle, section, start, vertical } from "./Bars.css";
import bars from "./Bars.json";
import Button from "./Button";
import items, { type ItemName } from "./barItems";

type Side = keyof typeof bars;
type Position = keyof (typeof bars)[Side];
interface BarOptions {
	vertical?: boolean;
	id: "t" | "b" | "l" | "r";
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
const positions: Record<Position, string> = { start, middle, end };

export default function Bar(props: BarOptions) {
	const bar = () => bars[sides[props.id]];
	const populated = () =>
		(Object.keys(positions) as Position[]).some(
			(pos) => bar()[pos].length > 0,
		);
	return (
		<Show when={populated()}>
			<nav
				aria-label={`${sides[props.id]} toolbar`}
				data-side={sides[props.id]}
				class={[main, props.vertical ? vertical : null]
					.filter(Boolean)
					.join(" ")}
			>
				<For each={Object.keys(positions) as Position[]}>
					{(pos) => (
						<div
							data-pos={pos}
							class={[section, positions[pos]].join(" ")}
						>
							<For each={resolveItems(bar()[pos])}>
								{(name) => <Button {...items[name]} />}
							</For>
						</div>
					)}
				</For>
			</nav>
		</Show>
	);
}
