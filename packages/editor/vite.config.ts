import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL("./playground", import.meta.url)),
});
