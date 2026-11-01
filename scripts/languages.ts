import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

export async function buildLanguageServers() {
	const services = [
		"vscode-html-languageservice",
		"vscode-css-languageservice",
		"vscode-json-languageservice",
	];
	async function copyPackage(
		name: string,
		parent: string,
		destination: string,
	) {
		const require = createRequire(parent);
		let source = path.dirname(require.resolve(name));
		let manifest: { name?: string; dependencies?: Record<string, string> };
		while (true) {
			try {
				manifest = JSON.parse(
					await readFile(path.join(source, "package.json"), "utf8"),
				);
				if (manifest.name === name) break;
			} catch {}
			const next = path.dirname(source);
			if (next === source)
				throw new Error(`Cannot locate language dependency ${name}`);
			source = next;
		}
		await cp(source, destination, {
			recursive: true,
			dereference: true,
			filter: (file) =>
				file === source || path.basename(file) !== "node_modules",
		});
		for (const dependency of Object.keys(manifest.dependencies ?? {}))
			await copyPackage(
				dependency,
				path.join(source, "package.json"),
				path.join(destination, "node_modules", dependency),
			);
	}
	for (const service of services)
		await copyPackage(
			service,
			path.resolve("package.json"),
			path.resolve("dist-electron/node_modules", service),
		);
	await mkdir("dist-electron/servers", { recursive: true });
	for (const name of [
		"typescript-language-server",
		"vscode-langservers-extracted",
	])
		await cp(
			`node_modules/${name}/LICENSE`,
			`dist-electron/servers/${name}.LICENSE`,
		);
	await cp(
		"node_modules/typescript-language-server/lib/cli.mjs",
		"dist-electron/servers/typescript.mjs",
	);
	await cp(
		"node_modules/typescript",
		"dist-electron/node_modules/typescript",
		{ recursive: true, dereference: true },
	);
	await Promise.all(
		["html", "css", "json"].map((language) =>
			build({
				entryPoints: [
					`node_modules/vscode-langservers-extracted/lib/${language}-language-server/node/${language}ServerMain.js`,
				],
				outfile: `dist-electron/servers/${language}.cjs`,
				bundle: true,
				platform: "node",
				format: "cjs",
				target: "node22",
				external: services,
			}),
		),
	);
}
