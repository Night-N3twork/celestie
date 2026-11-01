import { unwrap } from "./desktop/bridge";
import { DesktopFileHost } from "./desktop/fileHost";
import { createDesktopRuntime } from "./desktop/runtime";
import { WorkspaceFileHost } from "./dusk/workspaceFileHost";
import type { Platform } from "./services";
export function createPlatform(): Platform {
	const bridge = window.celestie;
	return bridge?.kind === "electron"
		? {
				kind: "desktop",
				files: new DesktopFileHost(bridge),
				...createDesktopRuntime(bridge),
				languages: {
					sync: (documents) =>
						unwrap(bridge.languages.sync(documents)),
					request: async <T>(
						id: string,
						method: string,
						params?: Record<string, unknown>,
					) =>
						unwrap(
							bridge.languages.request(id, method, params),
						) as Promise<T>,
					fileId: (uri) => unwrap(bridge.languages.fileId(uri)),
					restart: () => unwrap(bridge.languages.restart()),
					onDiagnostics: bridge.onDiagnostics,
				},
			}
		: { kind: "browser", files: new WorkspaceFileHost() };
}
