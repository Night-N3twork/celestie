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
	server: {
		host: true,
		allowedHosts: true,
	},
});
