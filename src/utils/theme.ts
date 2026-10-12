import { themeData } from "#theme";

export type ThemeName = keyof typeof themeData;

export type Theme = (typeof themeData)[ThemeName];

export type ThemeSelection = {
	name: ThemeName;
	type: string;
};

export function applyTheme(theme: ThemeName) {
	const root = document.documentElement;
	for (const [name, value] of Object.entries(themeData[theme].color)) {
		root.style.setProperty(`--color-${name}`, value);
	}
	root.style.colorScheme = themeData[theme].type;
	root.dataset.theme = theme;
	root.dataset.themeType = themeData[theme].type;
}

export function getTheme(): Theme {
	const root = document.documentElement;
	const [defaultName] = Object.keys(themeData) as ThemeName[];
	const selectedName = root.dataset.theme as ThemeName;
	const name = selectedName in themeData ? selectedName : defaultName;
	return themeData[name];
}
