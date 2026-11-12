import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
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
