import type { Disposable } from "../api/types";
import { builtinThemes } from "./builtin-themes";

export interface TokenStyle {
	readonly foreground?: string;
	readonly background?: string;
	readonly fontStyle?: string;
}
export type ThemeKind = "dark" | "light" | "contrast" | "contrast-light";
export interface EditorTheme {
	readonly base?: string;
	readonly kind?: ThemeKind;
	readonly colors?: Readonly<Record<string, string>>;
	readonly tokens?: Readonly<Record<string, TokenStyle>>;
}
export interface ResolvedTokenStyle {
	readonly foreground?: string;
	readonly background?: string;
	readonly italic?: boolean;
	readonly bold?: boolean;
	readonly underline?: boolean;
	readonly strikethrough?: boolean;
}
interface ThemeEntry {
	readonly kind: ThemeKind;
	readonly colors: Readonly<Record<string, string>>;
	readonly tokens: Readonly<Record<string, TokenStyle>>;
	readonly resolved: Map<string, ResolvedTokenStyle | undefined>;
}
const themes = new Map<string, ThemeEntry>();
const scopePattern = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
const fontStyles = new Set([
	"italic",
	"bold",
	"underline",
	"strikethrough",
	"normal",
]);
function safeValue(value: unknown): boolean {
	return (
		typeof value === "string" &&
		!!value.trim() &&
		!/[;{}<>\\]|url\s*\(|expression\s*\(/i.test(value)
	);
}
export function isTokenScope(kind: string): boolean {
	return scopePattern.test(kind);
}
export function registerTheme(name: string, theme: EditorTheme): Disposable {
	if (
		!name ||
		name === "auto" ||
		!theme ||
		(theme.colors !== undefined &&
			(typeof theme.colors !== "object" || theme.colors === null)) ||
		!Object.entries(theme.colors ?? {}).every(
			([key, value]) => /^[a-z][a-z0-9-]*$/.test(key) && safeValue(value),
		) ||
		(theme.kind !== undefined &&
			!["dark", "light", "contrast", "contrast-light"].includes(
				theme.kind,
			)) ||
		!Object.entries(theme.tokens ?? {}).every(
			([scope, style]) =>
				scopePattern.test(scope) &&
				!!style &&
				typeof style === "object" &&
				(style.foreground === undefined ||
					safeValue(style.foreground)) &&
				(style.background === undefined ||
					safeValue(style.background)) &&
				(style.fontStyle === undefined ||
					(typeof style.fontStyle === "string" &&
						style.fontStyle
							.split(/\s+/)
							.filter(Boolean)
							.every((part) => fontStyles.has(part)))),
		)
	)
		throw new TypeError("Invalid editor theme.");
	const previous = themes.get(name);
	if (theme.base && !themes.has(theme.base))
		throw new Error(`Unknown base theme: ${theme.base}`);
	const base = themes.get(theme.base ?? "dark");
	const tokens: Record<string, TokenStyle> = { ...base?.tokens };
	for (const [scope, style] of Object.entries(theme.tokens ?? {}))
		tokens[scope] = { ...tokens[scope], ...style };
	const entry: ThemeEntry = {
		kind: theme.kind ?? base?.kind ?? "dark",
		colors: { ...base?.colors, ...theme.colors },
		tokens,
		resolved: new Map(),
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
export function resolveThemeName(name: string, view: Window | null): string {
	if (name !== "auto") return name;
	const matches = (query: string) => !!view?.matchMedia?.(query).matches;
	const dark = matches("(prefers-color-scheme: dark)");
	if (
		matches("(forced-colors: active)") ||
		matches("(prefers-contrast: more)")
	)
		return dark ? "contrast" : "contrast-light";
	return dark ? "dark" : "light";
}
export function applyTheme(root: HTMLElement, name: string): void {
	const theme = themes.get(name);
	if (!theme) throw new Error(`Unknown editor theme: ${name}`);
	root.style.cssText = root.style.cssText.replace(/--editor-[^;]+;?/g, "");
	for (const [key, value] of Object.entries(theme.colors))
		root.style.setProperty(`--editor-${key}`, value);
	root.dataset.theme = name;
	root.dataset.themeKind = theme.kind;
}
export function themeKind(name: string): ThemeKind | undefined {
	return themes.get(name)?.kind;
}
export function hasTheme(name: string): boolean {
	return themes.has(name);
}
export function resolveTokenStyle(
	name: string,
	scope: string,
): ResolvedTokenStyle | undefined {
	const theme = themes.get(name);
	if (!theme || !scopePattern.test(scope)) return undefined;
	if (theme.resolved.has(scope)) return theme.resolved.get(scope);
	const parts = scope.split(".");
	let result: {
		foreground?: string;
		background?: string;
		italic?: boolean;
		bold?: boolean;
		underline?: boolean;
		strikethrough?: boolean;
	} = {};
	let matched = false;
	for (let length = 1; length <= parts.length; length++) {
		const rule = theme.tokens[parts.slice(0, length).join(".")];
		if (!rule) continue;
		matched = true;
		if (rule.foreground !== undefined) result.foreground = rule.foreground;
		if (rule.background !== undefined) result.background = rule.background;
		if (rule.fontStyle !== undefined) {
			const styles = new Set(rule.fontStyle.split(/\s+/).filter(Boolean));
			result = {
				...result,
				italic: styles.has("italic"),
				bold: styles.has("bold"),
				underline: styles.has("underline"),
				strikethrough: styles.has("strikethrough"),
			};
		}
	}
	const value = matched ? Object.freeze(result) : undefined;
	if (theme.resolved.size > 2000) theme.resolved.clear();
	theme.resolved.set(scope, value);
	return value;
}
export function tokenStyleText(style: ResolvedTokenStyle): string {
	const declarations: string[] = [];
	if (style.foreground) declarations.push(`color:${style.foreground}`);
	if (style.background) declarations.push(`background:${style.background}`);
	if (style.italic !== undefined)
		declarations.push(`font-style:${style.italic ? "italic" : "normal"}`);
	if (style.bold !== undefined)
		declarations.push(`font-weight:${style.bold ? "bold" : "normal"}`);
	const lines = [
		...(style.underline ? ["underline"] : []),
		...(style.strikethrough ? ["line-through"] : []),
	];
	if (style.underline !== undefined || style.strikethrough !== undefined)
		declarations.push(
			`text-decoration-line:${lines.length ? lines.join(" ") : "none"}`,
		);
	return declarations.join(";");
}

for (const [name, theme] of Object.entries(builtinThemes))
	registerTheme(name, theme);
