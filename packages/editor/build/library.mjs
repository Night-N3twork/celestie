import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
await build({
	configFile: fileURLToPath(new URL("vite.library.config.ts", root)),
});
const result = spawnSync(
	process.execPath,
	[
		require.resolve("typescript/bin/tsc"),
		"--project",
		fileURLToPath(new URL("tsconfig.declarations.json", root)),
	],
	{ stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(new URL("dist", root), { recursive: true });
await copyFile(
	require.resolve("prismjs/LICENSE"),
	new URL("dist/PRISM-LICENSE", root),
);
