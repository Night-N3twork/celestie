import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

const kib = 1024;
export function editorBundleBudgets(): Plugin {
	return {
		name: "editor-bundle-budgets",
		apply: "build",
		enforce: "post",
		generateBundle(_options, bundle) {
			const files = Object.values(bundle)
				.filter((file) => /\.(?:[cm]?js|css)$/.test(file.fileName))
				.map((file) => {
					const source =
							file.type === "chunk" ? file.code : file.source,
						bytes =
							typeof source === "string"
								? Buffer.from(source)
								: Buffer.from(source);
					return {
						file: file.fileName,
						raw: bytes.length,
						gzip: gzipSync(bytes).length,
					};
				});
			const limits = [
				{
					name: "All emitted JavaScript",
					entries: files.filter((file) =>
						/\.[cm]?js$/.test(file.file),
					),
					raw: 650 * kib,
					gzip: 200 * kib,
				},
				{
					name: "All stylesheets",
					entries: files.filter((file) => file.file.endsWith(".css")),
					raw: 40 * kib,
					gzip: 12 * kib,
				},
				{
					name: "Language worker",
					entries: files.filter((file) =>
						/languages\.worker(?:-|\.)/.test(file.file),
					),
					raw: 160 * kib,
					gzip: 55 * kib,
				},
			];
			const checks = limits.map(({ name, entries, raw, gzip }) => ({
				name,
				raw: entries.reduce((sum, file) => sum + file.raw, 0),
				gzip: entries.reduce((sum, file) => sum + file.gzip, 0),
				rawLimit: raw,
				gzipLimit: gzip,
			}));
			for (const check of checks)
				if (check.raw > check.rawLimit || check.gzip > check.gzipLimit)
					this.error(
						`${check.name} exceeds editor bundle budget: ${check.raw}/${check.rawLimit} raw, ${check.gzip}/${check.gzipLimit} gzip bytes.`,
					);
			this.emitFile({
				type: "asset",
				fileName: "editor-bundle-report.json",
				source: JSON.stringify({ files, checks }, null, 2),
			});
		},
	};
}
