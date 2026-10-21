import { MetaProvider } from "@solidjs/meta";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/sora";
import { render } from "solid-js/web";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

render(
	() => (
		<MetaProvider>
			<div></div>
		</MetaProvider>
	),
	root,
);
