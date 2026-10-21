import { glob, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import type { Component } from "solid-js";
import type { Plugin, ViteDevServer } from "vite";

async function icons(server: ViteDevServer, items?: string[]) {
	const root = server.config.root;
	const input = resolve(root, "src/icons");
	const output = resolve(root, "public/icons");

	const { createComponent, renderToString } = (await server.ssrLoadModule(
		"solid-js/web",
	)) as typeof import("solid-js/web");

	let count = 0;

	for await (const file of glob("**/*.svg.tsx", { cwd: input })) {
		const base = file.replace(/\.svg\.tsx$/, "");
		if (items?.length && !items.includes(base)) continue;

		const exports: Record<string, unknown> = await server.ssrLoadModule(
			resolve(input, file),
		);

		for (const [name, Icon] of Object.entries(exports)) {
			if (typeof Icon !== "function") continue;

			const svg = renderToString(() =>
				createComponent(Icon as Component<{ xmlns: string }>, {
					xmlns: "http://www.w3.org/2000/svg",
				}),
			);

			if (!/^<svg[\s>]/.test(svg) || !svg.endsWith("</svg>")) continue;

			const dest = resolve(output, `${base}.${name}.svg`);

			await mkdir(dirname(dest), { recursive: true });
			await writeFile(dest, svg, "utf8");
			count++;
		}
	}
	server.config.logger.info(
		`${chalk.cyan.bold("[icons]")} ${chalk.green(`built ${count} icon${count === 1 ? "" : "s"}.`)}`,
		{ timestamp: true },
	);
}

export default function iconsPlugin(items?: string[]): Plugin {
	return {
		name: "icons",
		async configureServer(server) {
			await server.watcher.unwatch(
				resolve(server.config.root, "public/icons"),
			);
			await icons(server, items);
			let pending = Promise.resolve();
			const input = resolve(server.config.root, "src/icons");
			server.watcher.on("all", (event, file) => {
				if (
					(event !== "change" &&
						event !== "add" &&
						event !== "unlink") ||
					!file.startsWith(`${input}/`) ||
					!/\.tsx?$/.test(file)
				)
					return;

				pending = pending
					.then(async () => {
						await icons(server, items);
					})
					.catch((error) => {
						server.config.logger.error(String(error));
					});
			});
		},
	};
}
