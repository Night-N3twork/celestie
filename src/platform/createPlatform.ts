import { DesktopFileHost } from "./desktop/fileHost";
import { WorkspaceFileHost } from "./dusk/workspaceFileHost";
import type { Platform } from "./services";
export function createPlatform(): Platform {
	const bridge = window.celestie;
	return bridge?.kind === "electron"
		? { kind: "desktop", files: new DesktopFileHost(bridge) }
		: { kind: "browser", files: new WorkspaceFileHost() };
}
