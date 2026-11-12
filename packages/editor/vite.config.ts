import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { editorBundleBudgets } from "./build/bundle-budgets.ts";

export default defineConfig({
	plugins: [editorBundleBudgets()],
	root: fileURLToPath(new URL("./playground", import.meta.url)),
	build: {
		rolldownOptions: {
			input: {
				editor: fileURLToPath(
					new URL("./playground/index.html", import.meta.url),
				),
				diff: fileURLToPath(
					new URL("./playground/diff.html", import.meta.url),
				),
			},
		},
	},
});
