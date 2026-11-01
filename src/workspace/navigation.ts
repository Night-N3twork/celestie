import type { Selection } from "../editor/core/selection";
import { LineIndex } from "../editor/view/lineIndex";
import type { ExplorerEntry } from "../platform/host";
import type { WorkspaceHost } from "../platform/services";
import { exclusionMatcher } from "./search";

export interface Location {
	id: string;
	selection: Selection;
}

export class NavigationHistory {
	private locations: Location[] = [];
	private cursor = -1;
	relocate(from: string, to: string): void {
		for (const location of this.locations)
			if (location.id === from || location.id.startsWith(`${from}/`))
				location.id = to + location.id.slice(from.length);
	}
	record(location: Location): void {
		const previous = this.locations[this.cursor];
		if (
			previous?.id === location.id &&
			previous.selection.anchor === location.selection.anchor &&
			previous.selection.head === location.selection.head
		)
			return;
		this.locations = this.locations.slice(0, this.cursor + 1);
		this.locations.push({
			id: location.id,
			selection: { ...location.selection },
		});
		if (this.locations.length > 100) this.locations.shift();
		this.cursor = this.locations.length - 1;
	}
	move(direction: -1 | 1, current?: Location): Location | undefined {
		if (current && this.cursor >= 0)
			this.locations[this.cursor] = {
				id: current.id,
				selection: { ...current.selection },
			};
		const next = this.cursor + direction;
		if (next < 0 || next >= this.locations.length) return;
		this.cursor = next;
		return this.locations[next];
	}
}

export function symbols(
	text: string,
): { name: string; offset: number; line: number }[] {
	const lines = new LineIndex(text);
	const result: { name: string; offset: number; line: number }[] = [];
	for (let line = 0; line < lines.count; line++) {
		const value = lines.line(line);
		const match =
			/^\s*(?:(?:export|default|declare|async|public|private|protected|static|abstract)\s+)*(?:function\s*\*?|class|interface|type|enum|def|struct|trait|fn|const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(
				value,
			);
		if (match)
			result.push({
				name: match[1],
				offset:
					lines.starts[line] +
					value.indexOf(match[1], match[0].length - match[1].length),
				line: line + 1,
			});
	}
	return result;
}

export async function listFiles(
	host: WorkspaceHost,
	roots: readonly ExplorerEntry[],
	signal: AbortSignal,
): Promise<{ entry: ExplorerEntry; path: string }[]> {
	const result: { entry: ExplorerEntry; path: string }[] = [];
	const excluded = exclusionMatcher(
		"**/node_modules/**, **/.git/**, **/dist/**",
	);
	const walk = async (entry: ExplorerEntry, path: string) => {
		for (const child of await host.readDirectory(entry.id)) {
			signal.throwIfAborted();
			const next = `${path}/${child.name}`;
			if (excluded(next)) continue;
			if (result.length >= 20000)
				throw new Error(
					"File index exceeds 20,000 entries. Use the explorer for remaining files.",
				);
			if (child.kind === "directory") await walk(child, next);
			else result.push({ entry: child, path: next });
			if (result.length % 32 === 0)
				await new Promise((resolve) => setTimeout(resolve, 0));
		}
	};
	for (const root of roots) await walk(root, root.name);
	return result;
}
