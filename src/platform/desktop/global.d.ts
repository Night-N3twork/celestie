import type { DesktopBridge } from "./bridge";

declare global {
	interface Window {
		celestie?: DesktopBridge;
	}
}
