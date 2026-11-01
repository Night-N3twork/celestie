import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import icons from "./plugins/icons.ts";

export default defineConfig({
	plugins: [
		solid({ ssr: true, solid: { hydratable: false } }),
		icons(["logo"]),
	],
	resolve: {
		tsconfigPaths: true,
	},
	worker: { format: "es" },
	preview: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	server: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
		host: true,
		allowedHosts: true,
	},
});
