import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { getIconsToolsetPath } from "app-builder-lib/out/toolsets/icons";
import { createServer } from "vite";

export async function createDesktopIcons() {
	const output = path.resolve("dist-electron/icons");
	const server = await createServer({ server: { middlewareMode: true } });
	try {
		const { createComponent, renderToString } =
			await server.ssrLoadModule("solid-js/web");
		const { default: Logo } = await server.ssrLoadModule(
			"/src/icons/logo.svg.tsx",
		);
		const svg = renderToString(() => createComponent(Logo, { size: 1024 }));
		await mkdir(output, { recursive: true });
		const inputFile = path.join(output, "icon.svg");
		await writeFile(inputFile, svg);
		const tool = path.join(await getIconsToolsetPath(), "icon-tool.js");
		const electron = createRequire(import.meta.url)("electron") as string;
		for (const outputFormat of ["set", "ico", "icns"] as const)
			await promisify(execFile)(
				electron,
				[
					tool,
					`--input=${inputFile}`,
					`--format=${outputFormat}`,
					`--out=${output}`,
				],
				{
					env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
					windowsHide: true,
				},
			);
	} finally {
		await server.close();
	}
}
