import { MetaProvider } from "@solidjs/meta";
import { applyTheme } from "@utils/theme.ts";
import Editor from "#Editor.tsx";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/sora";
import "./style.scss";
import { render } from "solid-js/web";

applyTheme("white");

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

render(
	() => (
		<MetaProvider>
			<Editor />
		</MetaProvider>
	),
	root,
);
