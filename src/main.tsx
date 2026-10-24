import { Link, MetaProvider, Title } from "@solidjs/meta";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/sora";
import Bar from "@nav/bar/Bar";
import { render } from "solid-js/web";
import { name } from "../package.json";
import "@style/main.scss";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

render(
	() => (
		<MetaProvider>
			<Title>{name.charAt(0).toUpperCase() + name.slice(1)}</Title>
			<Link rel="icon" type="image/svg+xml" href="/icons/logo.fav.svg" />

			<Bar top />
			<div class="main-container">
				<Bar left />
				<div class="main"></div>
				<Bar right />
			</div>
			<Bar bottom />
		</MetaProvider>
	),
	root,
);
