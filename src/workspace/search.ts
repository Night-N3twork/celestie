import {
	findMatches,
	type SearchMatch,
	type SearchOptions,
} from "../editor/core/search";
import type { BrowserFileHost } from "../platform/browser/fileHost";
import type { ExplorerEntry } from "../platform/host";

export interface FolderMatch {
	entry: ExplorerEntry;
	path: string;
	text: string;
	matches: SearchMatch[];
}

export function exclusionMatcher(patterns: string): (path: string) => boolean {
	const expressions = patterns
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((pattern) => {
			pattern = pattern.replace(/\\/g, "/");
			if (pattern.endsWith("/**")) pattern = pattern.slice(0, -3);
			const parts = pattern
				.replace(/\\/g, "/")
				.split(/(\*\*\/|\*\*|\*|\?)/);
			const expression = parts
				.map((part) =>
					part === "**/"
						? "(?:.*/)?"
						: part === "**"
							? ".*"
							: part === "*"
								? "[^/]*"
								: part === "?"
									? "[^/]"
									: part.replace(
											/[.*+?^${}()|[\]\\]/g,
											"\\$&",
										),
				)
				.join("");
			return new RegExp(
				`^(?:${pattern.includes("/") ? "" : "(?:.*/)?"})${expression}(?:/.*)?$`,
			);
		});
	return (path) => expressions.some((expression) => expression.test(path));
}

export async function searchFolders(
	host: BrowserFileHost,
	roots: readonly ExplorerEntry[],
	query: string,
	options: SearchOptions,
	exclusions: string,
	buffers: ReadonlyMap<string, string>,
	signal: AbortSignal,
	onResult: (result: FolderMatch) => void,
): Promise<{ files: number; skipped: number; limited: boolean }> {
	const excluded = exclusionMatcher(exclusions);
	let files = 0;
	let skipped = 0;
	let count = 0;
	let bytes = 0;
	let limited = false;
	const visit = async (directory: ExplorerEntry, prefix: string) => {
		for (const entry of await host.readDirectory(directory.id)) {
			signal.throwIfAborted();
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (excluded(relative)) continue;
			if (limited) return;
			if (entry.kind === "directory") {
				await visit(entry, relative);
				continue;
			}
			let text = buffers.get(entry.id);
			try {
				text ??= (await host.readSearchFile(entry.id))?.text;
			} catch {
				skipped++;
				continue;
			}
			signal.throwIfAborted();
			if (text === undefined) {
				skipped++;
				continue;
			}
			files++;
			bytes += text.length * 2;
			if (bytes > 32 * 1024 * 1024) {
				limited = true;
				return;
			}
			const matches = findMatches(text, query, options, 2001 - count);
			if (matches.length) {
				const remaining = Math.max(0, 2000 - count);
				onResult({
					entry,
					path: `${directoryRootName}/${relative}`,
					text,
					matches: matches.slice(0, remaining),
				});
				count += matches.length;
				if (count >= 2000) limited = true;
			}
			if (files % 8 === 0)
				await new Promise((resolve) => setTimeout(resolve, 0));
		}
	};
	let directoryRootName = "";
	if (query)
		for (const root of roots) {
			signal.throwIfAborted();
			directoryRootName = root.name;
			await visit(root, "");
			if (limited) break;
		}
	return { files, skipped, limited };
}
