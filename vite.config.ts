import { fileURLToPath } from "node:url";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import icons from "./plugins/icons.ts";

export default defineConfig({
	plugins: [
		vanillaExtractPlugin(),
		solid({ ssr: true, solid: { hydratable: false } }),
		icons(),
	],
	resolve: {
		alias: [
			{
				find: /^@(assets|components|editor|icons|pages|style|utils)\//,
				replacement: `${fileURLToPath(new URL("./src/", import.meta.url))}$1/`,
			},
			{
				find: /^#(.*)/,
				replacement: `${fileURLToPath(new URL("./src/", import.meta.url))}$1`,
			},
		],
	},
	server: {
		host: true,
		allowedHosts: true,
	},
});
