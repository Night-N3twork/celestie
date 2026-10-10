import { themeData, themes } from "#theme.css";

export type ThemeName = keyof typeof themeData;

export type Theme = (typeof themeData)[ThemeName];

export type ThemeSelection = {
	name: ThemeName;
	type: string;
};

export function applyTheme(theme: ThemeName) {
	const root = document.documentElement;
	root.classList.remove(...Object.values(themes));
	root.classList.add(themes[theme]);
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
