import { createMemo, createSignal } from "solid-js";

export interface Tab {
	id: number;
	title: string;
}

export interface TabsState {
	tabs: Tab[];
	activeId: number | null;
	nextId: number;
}

export function newTab(state: TabsState): TabsState {
	const id = state.nextId;
	return {
		tabs: [...state.tabs, { id, title: `Untitled-${id}` }],
		activeId: id,
		nextId: id + 1,
	};
}

export function selectTab(state: TabsState, id: number): TabsState {
	return state.tabs.some((tab) => tab.id === id)
		? { ...state, activeId: id }
		: state;
}

export function closeTab(state: TabsState, id: number): TabsState {
	const index = state.tabs.findIndex((tab) => tab.id === id);
	if (index === -1) return state;
	const tabs = state.tabs.filter((tab) => tab.id !== id);
	return {
		...state,
		tabs,
		activeId:
			state.activeId === id
				? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
				: state.activeId,
	};
}

export function moveTab(
	state: TabsState,
	id: number,
	targetId: number,
): TabsState {
	const from = state.tabs.findIndex((tab) => tab.id === id);
	const to = state.tabs.findIndex((tab) => tab.id === targetId);
	if (from === -1 || to === -1 || from === to) return state;
	const tabs = [...state.tabs];
	const [tab] = tabs.splice(from, 1);
	tabs.splice(to, 0, tab);
	return { ...state, tabs };
}

export function newTabs() {
	const [state, setState] = createSignal<TabsState>(
		newTab({ tabs: [], activeId: null, nextId: 1 }),
	);
	const active = createMemo(() =>
		state().tabs.find((tab) => tab.id === state().activeId),
	);

	return {
		state,
		active,
		add: () => setState(newTab),
		select: (id: number) => setState((current) => selectTab(current, id)),
		close: (id: number) => setState((current) => closeTab(current, id)),
		move: (id: number, targetId: number) =>
			setState((current) => moveTab(current, id, targetId)),
	};
}

export type TabsController = ReturnType<typeof newTabs>;
