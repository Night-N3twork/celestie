import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import icons from "./plugins/icons";

export default defineConfig({
	plugins: [react(), icons()],
	server: {
		host: true,
		allowedHosts: true
	},
});
