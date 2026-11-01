import type { DirectoryHandle } from "../browser/fileHost";
import type { ExplorerEntry } from "../host";
import { DirectoryBackend } from "./directoryBackend";
import { duskEnvironment, duskId } from "./environment";
export function workspaceRuntime(
	directory: (id: string) => Promise<DirectoryHandle>,
) {
	const mounts = new Map<string, string>();
	return async (entry: ExplorerEntry): Promise<string> => {
		if (entry.id.startsWith("dusk:")) return entry.id;
		const known = mounts.get(entry.id);
		if (known) return known;
		const handle = await directory(entry.id),
			environment = await duskEnvironment();
		const parent = `/home/user/projects/local-${encodeURIComponent(entry.id)}`;
		await environment.fs.mkdir(parent, { recursive: true });
		const path = `${parent}/${entry.name}`;
		environment.mount(path, new DirectoryBackend(handle));
		const id = duskId(path);
		mounts.set(entry.id, id);
		return id;
	};
}
