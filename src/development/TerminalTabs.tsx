import { createSignal, For, onMount } from "solid-js";
import AddIcon from "../icons/actions/add.svg";
import CloseIcon from "../icons/actions/close.svg";
import { duskTerminals } from "../platform/dusk/terminalHost";
import type { TerminalHost } from "../platform/services";
import ActionButton from "../workbench/ActionButton";
import TerminalPanel from "./TerminalPanel";

export default function TerminalTabs(props: {
	root: string;
	host?: TerminalHost;
}) {
	const [sessions, setSessions] = createSignal<
		{ id: number; root: string }[]
	>([]);
	const [exited, setExited] = createSignal(new Set<number>());
	const [active, setActive] = createSignal<number>();
	let next = 0;
	const add = () => {
		if (!props.root) return;
		const session = { id: ++next, root: props.root };
		setSessions((items) => [...items, session]);
		setActive(session.id);
	};
	const close = (id: number) => {
		const remaining = sessions().filter((session) => session.id !== id);
		setSessions(remaining);
		if (active() === id) setActive(remaining.at(-1)?.id);
	};
	onMount(add);
	return (
		<div class="terminal-sessions">
			<nav class="terminal-tabs" aria-label="Terminal sessions">
				<For each={sessions()}>
					{(session) => (
						<div class="terminal-tab">
							<button
								type="button"
								aria-pressed={active() === session.id}
								title={session.root}
								onClick={() => setActive(session.id)}
							>
								Terminal {session.id}
								{exited().has(session.id) ? " (exited)" : ""}
							</button>
							<ActionButton
								icon={CloseIcon}
								label={`Close terminal ${session.id}`}
								compact
								onClick={() => close(session.id)}
							/>
						</div>
					)}
				</For>
				<ActionButton
					icon={AddIcon}
					label="New terminal"
					compact
					onClick={add}
					disabled={!props.root}
				/>
			</nav>
			<For each={sessions()}>
				{(session) => (
					<div
						class="terminal-session"
						hidden={active() !== session.id}
					>
						<TerminalPanel
							root={session.root}
							host={props.host ?? duskTerminals}
							active={active() === session.id}
							onExit={() =>
								setExited(
									(items) => new Set([...items, session.id]),
								)
							}
						/>
					</div>
				)}
			</For>
		</div>
	);
}
