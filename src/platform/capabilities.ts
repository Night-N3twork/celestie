declare global {
	interface Window {
		celestie?: unknown;
	}
	interface Process {
		versions?: {
			electron?: unknown;
		};
	}
}

export function isElectron(): boolean {
	return (
		(typeof window !== "undefined" &&
			typeof window.celestie !== "undefined") ||
		(typeof process !== "undefined" &&
			typeof process.versions?.electron !== "undefined") ||
		(typeof navigator !== "undefined" &&
			typeof navigator.userAgent === "string" &&
			navigator.userAgent.toLowerCase().includes("electron"))
	);
}
