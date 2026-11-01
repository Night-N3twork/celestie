import type { EditorSettings } from "../settings/editorSettings";

export async function formatDocument(
	text: string,
	name: string,
	settings: EditorSettings,
): Promise<string> {
	const extension = name.split(".").at(-1)?.toLowerCase();
	const prettier = await import("prettier/standalone");
	let parser: string;
	let plugins: import("prettier").Plugin[];
	if (
		["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc"].includes(
			extension ?? "",
		)
	) {
		parser =
			extension === "ts" || extension === "tsx"
				? "typescript"
				: extension === "json"
					? "json"
					: extension === "jsonc"
						? "json5"
						: "babel";
		plugins = await Promise.all([
			import("prettier/plugins/typescript"),
			import("prettier/plugins/babel"),
			import("prettier/plugins/estree"),
		]);
	} else if (["css", "scss", "less"].includes(extension ?? "")) {
		parser = extension ?? "css";
		plugins = [await import("prettier/plugins/postcss")];
	} else if (["html", "vue"].includes(extension ?? "")) {
		parser = extension ?? "html";
		plugins = [await import("prettier/plugins/html")];
	} else if (["md", "mdx"].includes(extension ?? "")) {
		parser = extension === "mdx" ? "mdx" : "markdown";
		plugins = [await import("prettier/plugins/markdown")];
	} else if (["yml", "yaml"].includes(extension ?? "")) {
		parser = "yaml";
		plugins = [await import("prettier/plugins/yaml")];
	} else throw new Error("No formatter is configured for this file type.");
	return prettier.format(text, {
		parser,
		plugins,
		tabWidth: settings.tabSize,
		useTabs: !settings.insertSpaces,
		endOfLine: text.includes("\r\n")
			? "crlf"
			: text.includes("\r")
				? "cr"
				: "lf",
	});
}
