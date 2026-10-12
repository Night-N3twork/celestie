import type { FSBackend, ProcessManager } from "@nightnetwork/dusk";

export interface Runtime {
	files: FSBackend;
	processes: ProcessManager;
}

let runtime: Promise<Runtime> | undefined;

export function getRuntime(): Promise<Runtime> {
	runtime ??= createRuntime().catch((error: unknown) => {
		runtime = undefined;
		throw error;
	});
	return runtime;
}

async function createRuntime(): Promise<Runtime> {
	const { createTfsBackend, ProcessManager } = await import(
		"@nightnetwork/dusk"
	);
	const files = await createTfsBackend();
	for (const path of ["/bin", "/tmp", "/home/user"]) {
		await files.mkdir(path, { recursive: true });
	}
	return { files, processes: new ProcessManager(files) };
}

export async function disposeRuntime(): Promise<void> {
	const pending = runtime;
	if (!pending) return;
	try {
		const { processes } = await pending;
		for (const pid of processes.activePids())
			processes.getProcess(pid)?.kill();
		processes.close();
	} finally {
		if (runtime === pending) runtime = undefined;
	}
}
