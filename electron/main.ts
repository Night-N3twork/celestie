import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	nativeTheme,
	protocol,
	session,
} from "electron";
import { NativeWorkspace } from "./files";
import { registerFiles } from "./ipc";
import { NativeLanguages } from "./languages";
import { NativeRuntime } from "./runtime";
import { registerWindow } from "./window";

protocol.registerSchemesAsPrivileged([
	{
		scheme: "celestie",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			stream: true,
			corsEnabled: true,
			codeCache: true,
		},
	},
]);
app.setName("Celestie");
if (process.platform === "win32")
	app.setAppUserModelId("network.night.celestie");
const profile = app.commandLine.getSwitchValue("user-data-dir");
if (profile) app.setPath("userData", path.resolve(profile));
else if (!app.isPackaged && process.env.CELESTIE_PROFILE)
	app.setPath("userData", path.resolve(process.env.CELESTIE_PROFILE));
else if (!app.isPackaged)
	app.setPath(
		"userData",
		path.join(app.getPath("appData"), "Celestie Development"),
	);
const directory = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.find((arg) => arg.startsWith("--dev-url="))?.slice(10);
if (
	dev &&
	(app.isPackaged || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(dev))
)
	throw new Error("Invalid development URL.");
const url = new URL(dev ?? "celestie://app/index.html").href;
const trustedOrigin = dev ? new URL(dev).origin : "celestie://app";
const csp =
	"default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob: data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* https: wss: blob: data:; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
let window: BrowserWindow | undefined;
let files: NativeWorkspace;
let runtime: NativeRuntime;
let languages: NativeLanguages;
let quitting = false;
const titleBarOverlay = () => ({
	color: "#00000000",
	symbolColor: nativeTheme.shouldUseDarkColors ? "#d4d0dc" : "#24202c",
	height: 44,
});
function createWindow() {
	window = new BrowserWindow({
		width: 1360,
		height: 900,
		minWidth: 650,
		minHeight: 450,
		show: false,
		backgroundColor: "#101014",
		title: "Celestie",
		icon: path.join(
			directory,
			"icons",
			process.platform === "win32" ? "icon.ico" : "512x512.png",
		),
		titleBarStyle: "hidden",
		titleBarOverlay:
			process.platform === "darwin" ? false : titleBarOverlay(),
		autoHideMenuBar: true,
		...(process.platform === "darwin"
			? { trafficLightPosition: { x: 14, y: 18 } }
			: {}),
		webPreferences: {
			preload: path.join(directory, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	window.setMenuBarVisibility(false);
	window.webContents.on("before-input-event", (event, input) => {
		if (
			input.type !== "keyDown" ||
			!(input.control || input.meta) ||
			input.alt ||
			![
				"Equal",
				"Minus",
				"Digit0",
				"NumpadAdd",
				"NumpadSubtract",
				"Numpad0",
			].includes(input.code)
		)
			return;
		const contents = window?.webContents;
		if (!contents) return;
		event.preventDefault();
		const reset = input.code === "Digit0" || input.code === "Numpad0";
		const direction =
			input.code === "Minus" || input.code === "NumpadSubtract" ? -1 : 1;
		contents.setZoomLevel(
			reset
				? 0
				: Math.max(
						-5,
						Math.min(8, contents.getZoomLevel() + direction),
					),
		);
	});
	window.webContents.on("will-prevent-unload", (event) => {
		if (!window) return;
		const response = dialog.showMessageBoxSync(window, {
			type: "warning",
			buttons: ["Keep editing", "Close without saving"],
			defaultId: 0,
			cancelId: 0,
			message: "You have unsaved changes.",
			detail: "Your files have not been saved to disk.",
		});
		if (response === 1) event.preventDefault();
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, target) => {
		if (target !== url) event.preventDefault();
	});
	window.on("ready-to-show", () => window?.show());
	window.on("closed", () => {
		void runtime?.close();
		void languages?.close();
		window = undefined;
	});
	window.webContents.on("render-process-gone", (_event, details) => {
		console.error("Renderer exited:", details.reason);
		void runtime.close();
		void languages.close();
	});
	window.webContents.on(
		"did-start-navigation",
		(_event, _url, _inPlace, mainFrame) => {
			if (mainFrame) {
				void runtime.close();
				void languages.close();
			}
		},
	);
	void window.loadURL(url);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => {
		if (window?.isMinimized()) window.restore();
		window?.focus();
	});
	void app
		.whenReady()
		.then(async () => {
			if (process.platform === "darwin")
				app.dock?.setIcon(path.join(directory, "icons", "512x512.png"));
			await fs.mkdir(app.getPath("userData"), { recursive: true });
			files = new NativeWorkspace(
				path.join(app.getPath("userData"), "workspace.json"),
				(change) => {
					if (window && !window.isDestroyed())
						window.webContents.send("files.changed", change);
				},
			);
			await files.load();
			if (!dev) {
				const root = path.resolve(directory, "../dist");
				protocol.handle("celestie", async (request) => {
					const target = new URL(request.url);
					if (target.hostname !== "app")
						return new Response(null, { status: 403 });
					let filename: string;
					try {
						filename = path.resolve(
							root,
							`.${decodeURIComponent(target.pathname)}`,
						);
					} catch {
						return new Response(null, { status: 400 });
					}
					const relative = path.relative(root, filename);
					if (
						relative === ".." ||
						relative.startsWith(`..${path.sep}`) ||
						path.isAbsolute(relative)
					)
						return new Response(null, { status: 403 });
					const types: Record<string, string> = {
						".html": "text/html",
						".js": "text/javascript",
						".css": "text/css",
						".json": "application/json",
						".wasm": "application/wasm",
						".svg": "image/svg+xml",
						".woff2": "font/woff2",
						".png": "image/png",
					};
					try {
						return new Response(await fs.readFile(filename), {
							headers: {
								"Content-Type":
									types[path.extname(filename)] ??
									"application/octet-stream",
								"Cross-Origin-Opener-Policy": "same-origin",
								"Cross-Origin-Embedder-Policy": "require-corp",
								"Content-Security-Policy": csp,
							},
						});
					} catch {
						return new Response(null, { status: 404 });
					}
				});
			}
			session.defaultSession.setPermissionRequestHandler(
				(_contents, _permission, callback) => callback(false),
			);
			session.defaultSession.setPermissionCheckHandler(() => false);
			session.defaultSession.webRequest.onHeadersReceived(
				(details, callback) => {
					const headers = Object.fromEntries(
						Object.entries(details.responseHeaders ?? {}).filter(
							([key]) =>
								![
									"cross-origin-opener-policy",
									"cross-origin-embedder-policy",
									"content-security-policy",
								].includes(key.toLowerCase()),
						),
					);
					callback({
						responseHeaders: {
							...headers,
							"Cross-Origin-Opener-Policy": ["same-origin"],
							"Cross-Origin-Embedder-Policy": ["require-corp"],
							"Content-Security-Policy": [csp],
						},
					});
				},
			);
			registerFiles(files, () => window, trustedOrigin);
			registerWindow(() => window, trustedOrigin);
			runtime = new NativeRuntime(files, () => window, trustedOrigin);
			languages = new NativeLanguages(
				files,
				app.isPackaged
					? path.join(
							process.resourcesPath,
							"app.asar.unpacked/dist-electron",
						)
					: directory,
				() => window,
				trustedOrigin,
			);
			Menu.setApplicationMenu(
				Menu.buildFromTemplate([
					{
						label: "File",
						submenu: [{ role: "close" }, { role: "quit" }],
					},
					{
						label: "Edit",
						submenu: [
							{ role: "undo" },
							{ role: "redo" },
							{ type: "separator" },
							{ role: "cut" },
							{ role: "copy" },
							{ role: "paste" },
							{ role: "selectAll" },
						],
					},
					{
						label: "View",
						submenu: [
							{ role: "reload" },
							...(app.isPackaged
								? []
								: [{ role: "toggleDevTools" as const }]),
							{ role: "resetZoom" },
							{ role: "zoomIn", accelerator: "CmdOrCtrl+=" },
							{ role: "zoomOut" },
							{ role: "togglefullscreen" },
						],
					},
				]),
			);
			createWindow();
			app.on("activate", () => {
				if (!BrowserWindow.getAllWindows().length) createWindow();
			});
		})
		.catch((error) => {
			console.error(error);
			app.exit(1);
		});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("before-quit", (event) => {
		if (quitting) return;
		event.preventDefault();
		void (async () => {
			await runtime?.close();
			await languages?.close();
			files?.close();
			quitting = true;
			app.quit();
		})();
	});
}
