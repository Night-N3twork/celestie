import { contextBridge, ipcRenderer } from "electron";
import type {
	DesktopBridge,
	Result,
	RuntimeEvent,
} from "../src/platform/desktop/bridge";
import type { FileChange } from "../src/platform/services";

const invoke = <T>(method: string, ...args: unknown[]): Promise<Result<T>> =>
	ipcRenderer.invoke(`files.${method}`, ...args);
const bridge: DesktopBridge = {
	kind: "electron",
	platform: process.platform,
	runtime: {
		spawn: (options) => ipcRenderer.invoke("runtime.spawn", options),
		runScript: (cwd, name) =>
			ipcRenderer.invoke("runtime.runScript", cwd, name),
		open: (options) => ipcRenderer.invoke("runtime.open", options),
		listen: (id) => ipcRenderer.invoke("runtime.listen", id),
		write: (id, data) => ipcRenderer.invoke("runtime.write", id, data),
		resize: (id, cols, rows) =>
			ipcRenderer.invoke("runtime.resize", id, cols, rows),
		stop: (id) => ipcRenderer.invoke("runtime.stop", id),
	},
	onRuntimeEvent: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			event: RuntimeEvent,
		) => listener(event);
		ipcRenderer.on("runtime.event", receive);
		return () => ipcRenderer.removeListener("runtime.event", receive);
	},
	files: {
		openFolder: () => invoke("openFolder"),
		openFile: () => invoke("openFile"),
		restore: () => invoke("restore"),
		reconnect: (id) => invoke("reconnect", id),
		removeRoot: (id) => invoke("removeRoot", id),
		readDirectory: (id) => invoke("readDirectory", id),
		readBytes: (id) => invoke("readBytes", id),
		stat: (id) => invoke("stat", id),
		saveText: (id, text, name, options) =>
			invoke("saveText", id, text, name, options),
		writeBytes: (id, bytes, stamp) =>
			invoke("writeBytes", id, bytes, stamp),
		create: (parent, name, kind) => invoke("create", parent, name, kind),
		remove: (id, recursive) => invoke("remove", id, recursive),
		move: (id, parent, name) => invoke("move", id, parent, name),
		exportText: (file) => invoke("exportText", file),
	},
	onFileChange: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			change: FileChange,
		) => listener(change);
		ipcRenderer.on("files.changed", receive);
		return () => ipcRenderer.removeListener("files.changed", receive);
	},
};
contextBridge.exposeInMainWorld("celestie", bridge);
