import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { editorBundleBudgets } from "./build/bundle-budgets.ts";
export default defineConfig({
	plugins: [editorBundleBudgets()],
	root: fileURLToPath(new URL("./", import.meta.url)),
	base: "./",
	build: {
		outDir: fileURLToPath(new URL("./dist", import.meta.url)),
		emptyOutDir: true,
		lib: {
			entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
			formats: ["es"],
			fileName: "index",
			cssFileName: "editor",
		},
	},
	worker: {
		format: "es",
		rolldownOptions: { output: { entryFileNames: "workers/[name].js" } },
	},
});
