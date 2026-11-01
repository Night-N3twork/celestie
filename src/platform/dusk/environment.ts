import type { FSBackend, ProcessManager } from "@nightnetwork/dusk";
import { taskNodeSource } from "./taskNode";
import { workspaceFilesystem } from "./workspaceFilesystem";
export interface DuskEnvironment {
	fs: FSBackend;
	processes: ProcessManager;
	mount: (path: string, backend: FSBackend) => void;
}

let pending: Promise<DuskEnvironment> | undefined;
export function duskEnvironment(): Promise<DuskEnvironment> {
	if (!pending)
		pending = boot().catch((error) => {
			pending = undefined;
			throw error;
		});
	return pending;
}
async function boot(): Promise<DuskEnvironment> {
	if (!crossOriginIsolated)
		throw new Error(
			"Dusk requires cross-origin isolation. Serve Celestie with COOP/COEP headers.",
		);
	const {
		createTfsBackend,
		createMemoryBackend,
		createLayoutBackend,
		ProcessManager,
	} = await import("@nightnetwork/dusk");
	let backend = await createTfsBackend();
	const forwarding = new Proxy({} as FSBackend, {
		get: (_, key) => {
			const value = backend[key as keyof FSBackend];
			return typeof value === "function" ? value.bind(backend) : value;
		},
	});
	const workspace = workspaceFilesystem(forwarding);
	const processes = new ProcessManager(workspace.fs);
	backend = await createLayoutBackend({
		persistent: backend,
		ephemeral: createMemoryBackend(),
		processManager: processes,
		user: "user",
		hostname: "celestie",
	});
	await backend.mkdir("/home/user/projects", { recursive: true });
	processes.registerBinary("/bin/celestie-task-node", taskNodeSource);
	return { fs: workspace.fs, processes, mount: workspace.mount };
}
export const duskId = (path: string) => `dusk:${path}`;
export function duskPath(id: string): string {
	if (!id.startsWith("dusk:/home/user/projects/"))
		throw new Error("Open a workspace folder.");
	const path = id.slice(5);
	if (
		path
			.split("/")
			.some(
				(part) => part === ".." || part === "." || part.includes("\0"),
			)
	)
		throw new Error("Invalid project path.");
	return path;
}
