import { spawn } from "node:child_process";
import { cp, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createServer } from "vite";
import { createDesktopIcons } from "./icons";
import { buildLanguageServers } from "./languages";

const development = process.argv.includes("--dev");
await createDesktopIcons();
await buildLanguageServers();
await cp("node_modules/node-pty", "dist-electron/node_modules/node-pty", {
	recursive: true,
	dereference: true,
	filter: async (source, destination) => {
		if (!(await stat(source)).isFile()) return true;
		try {
			return !(await readFile(source)).equals(
				await readFile(destination),
			);
		} catch {
			return true;
		}
	},
});
await build({
	entryPoints: ["electron/main.ts"],
	outfile: "dist-electron/main.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	banner: {
		js: 'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);',
	},
	target: "node22",
	external: ["electron", "node-pty"],
	sourcemap: development,
});
await build({
	entryPoints: ["electron/preload.ts"],
	outfile: "dist-electron/preload.cjs",
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["electron"],
	sourcemap: development,
});
if (development) {
	const server = await createServer({
		server: { host: "127.0.0.1", port: 4173, strictPort: true },
	});
	await server.listen();
	const executable = createRequire(import.meta.url)("electron") as string;
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(
		executable,
		["dist-electron/main.mjs", "--dev-url=http://127.0.0.1:4173"],
		{ stdio: "inherit", env, windowsHide: false },
	);
	let closing = false;
	const close = async (code: number) => {
		if (closing) return;
		closing = true;
		if (child.exitCode === null) child.kill();
		await server.close();
		process.exitCode = code;
	};
	child.on("error", (error) => {
		console.error(error);
		void close(1);
	});
	child.on("exit", (code) => void close(code ?? 1));
	process.on("SIGINT", () => void close(0));
	process.on("SIGTERM", () => void close(0));
}
