import type { Disposable } from "../api/types";
export interface EditorTheme {
	readonly base?: string;
	readonly colors: Readonly<Record<string, string>>;
}
const themes = new Map<string, EditorTheme>();
export function registerTheme(name: string, theme: EditorTheme): Disposable {
	if (
		!name ||
		!Object.entries(theme.colors).every(
			([key, value]) =>
				/^[a-z][a-z0-9-]*$/.test(key) && !/[;{}]/.test(value),
		)
	)
		throw new TypeError("Invalid editor theme.");
	const previous = themes.get(name);
	if (theme.base && !themes.has(theme.base))
		throw new Error(`Unknown base theme: ${theme.base}`);
	const entry = {
		colors: {
			...themes.get(theme.base ?? "dark")?.colors,
			...theme.colors,
		},
	};
	themes.set(name, entry);
	return {
		dispose() {
			if (themes.get(name) === entry) {
				if (previous) themes.set(name, previous);
				else themes.delete(name);
			}
		},
	};
}
export function applyTheme(root: HTMLElement, name: string): void {
	const theme = themes.get(name);
	if (!theme) throw new Error(`Unknown editor theme: ${name}`);
	root.style.cssText = root.style.cssText.replace(/--editor-[^;]+;?/g, "");
	for (const [key, value] of Object.entries(theme.colors))
		root.style.setProperty(`--editor-${key}`, value);
	root.dataset.theme = name;
}
registerTheme("dark", {
	colors: {
		background: "#1e1e1e",
		foreground: "#d4d4d4",
		panel: "#252526",
		border: "#454545",
		selection: "#264f78",
		accent: "#75beff",
		comment: "#6a9955",
		keyword: "#569cd6",
		string: "#ce9178",
		number: "#b5cea8",
		type: "#4ec9b0",
		function: "#dcdcaa",
		error: "#f48771",
		warning: "#dcca70",
	},
});
registerTheme("light", {
	colors: {
		background: "#ffffff",
		foreground: "#202020",
		panel: "#f3f3f3",
		border: "#b8b8b8",
		selection: "#add6ff",
		accent: "#005fb8",
		comment: "#008000",
		keyword: "#0000ff",
		string: "#a31515",
		number: "#098658",
		type: "#267f99",
		function: "#795e26",
		error: "#c72e2e",
		warning: "#947200",
	},
});
registerTheme("contrast", {
	colors: {
		background: "#000000",
		foreground: "#ffffff",
		panel: "#000000",
		border: "#ffffff",
		selection: "#16407d",
		accent: "#ffff00",
		comment: "#7cffa0",
		keyword: "#8fcfff",
		string: "#ffbfa8",
		number: "#d5ff99",
		type: "#66ffff",
		function: "#ffffa0",
		error: "#ff7070",
		warning: "#ffff00",
	},
});

export function hasTheme(name: string): boolean {
	return themes.has(name);
}
