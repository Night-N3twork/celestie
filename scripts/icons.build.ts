import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Glob } from "bun";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const input = resolve(root, "src/icons");
const output = resolve(root, "public/icons");

const variants = new Set(["Icon", "Favicon"]);

for await (const file of new Glob(`**/*.svg.tsx`).scan(input)) {
	const source = pathToFileURL(resolve(input, file)).href;
	const exports: Record<string, unknown> = await import(source);
	const base = file.replace(/\.svg\.tsx$/, "");

	for (const [name, Component] of Object.entries(exports)) {
		if (typeof Component !== "function" || !variants.has(name)) continue;

		const svg = renderToStaticMarkup(
			createElement(Component as FunctionComponent<{ xmlns: string }>, {
				xmlns: "http://www.w3.org/2000/svg",
			}),
		);

		if (!/^<svg[\s>]/.test(svg) || !svg.endsWith("</svg>")) continue;

		const suffix = name === "Favicon" ? ".fav" : "";
		const dest = resolve(output, `${base}${suffix}.svg`);

		await mkdir(dirname(dest), { recursive: true });
		await Bun.write(dest, svg);
		console.log(`${file} (${name}) -> ${dest.slice(root.length + 1)}`);
	}
}
