import { MetaProvider } from "@solidjs/meta";
import { applyTheme } from "@utils/theme.ts";
import Editor from "#Editor.tsx";
import "./style.css";
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
