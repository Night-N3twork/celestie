import type { BrowserWindow } from "electron";
import { registerMethods } from "./ipc";

export function registerWindow(
	getWindow: () => BrowserWindow | undefined,
	origin: string,
) {
	registerMethods(
		"window",
		{
			theme: (color, symbolColor, height) => {
				if (
					typeof color !== "string" ||
					typeof symbolColor !== "string" ||
					!/^#[\da-f]{6}$/i.test(color) ||
					!/^#[\da-f]{6}$/i.test(symbolColor) ||
					!Number.isFinite(height) ||
					Number(height) < 20 ||
					Number(height) > 200
				)
					throw new Error("Invalid title bar theme.");
				const window = getWindow();
				if (
					window &&
					!window.isDestroyed() &&
					process.platform !== "darwin"
				)
					window.setTitleBarOverlay({
						color: `${color}00`,
						symbolColor,
						height: Math.round(
							Number(height) * window.webContents.getZoomFactor(),
						),
					});
			},
		},
		getWindow,
		origin,
	);
}
