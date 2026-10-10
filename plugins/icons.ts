import { glob, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Component } from "solid-js";
import type { Plugin, ViteDevServer } from "vite";

async function icons(server: ViteDevServer) {
	const root = server.config.root;
	const input = resolve(root, "src/icons");
	const output = resolve(root, "public/icons");

	const variants = new Set(["Icon", "Favicon"]);

	const { createComponent, renderToString } = (await server.ssrLoadModule(
		"solid-js/web",
	)) as typeof import("solid-js/web");

	for await (const file of glob("**/*.svg.tsx", { cwd: input })) {
		const exports: Record<string, unknown> = await server.ssrLoadModule(
			resolve(input, file),
		);
		const base = file.replace(/\.svg\.tsx$/, "");

		for (const [name, Icon] of Object.entries(exports)) {
			if (typeof Icon !== "function" || !variants.has(name)) continue;

			const svg = renderToString(() =>
				createComponent(Icon as Component<{ xmlns: string }>, {
					xmlns: "http://www.w3.org/2000/svg",
				}),
			);

			if (!/^<svg[\s>]/.test(svg) || !svg.endsWith("</svg>")) continue;

			const suffix = name === "Favicon" ? ".fav" : "";
			const dest = resolve(output, `${base}${suffix}.svg`);

			await mkdir(dirname(dest), { recursive: true });
			await writeFile(dest, svg, "utf8");
			console.log(`${file} (${name}) -> ${dest.slice(root.length + 1)}`);
		}
	}
}

export default function iconsPlugin(): Plugin {
	return {
		name: "icons",
		async configureServer(server) {
			await icons(server);
			let pending = Promise.resolve();
			const input = resolve(server.config.root, "src/icons");
			server.watcher.on("all", (event, file) => {
				if (
					(event !== "change" && event !== "add") ||
					!file.startsWith(`${input}/`) ||
					!file.endsWith(".svg.tsx")
				)
					return;

				pending = pending
					.then(async () => {
						await icons(server);
						server.ws.send({ type: "full-reload" });
					})
					.catch((error) => {
						server.config.logger.error(String(error));
					});
			});
		},
	};
}
