import { type BrowserWindow, ipcMain } from "electron";
import type { NativeWorkspace } from "./files";

const string = (value: unknown) => {
	if (typeof value !== "string") throw new Error("Expected text.");
	return value;
};
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected an object.");
	return value as Record<string, unknown>;
}
export function registerFiles(
	files: NativeWorkspace,
	getWindow: () => BrowserWindow | undefined,
	origin: string,
) {
	const window = () => {
		const value = getWindow();
		if (!value || value.isDestroyed())
			throw new Error("Application window is closed.");
		return value;
	};
	const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {
		openFolder: () => files.openFolder(window()),
		openFile: () => files.openFile(window()),
		restore: () => files.restore(),
		reconnect: (id) => files.reconnect(string(id)),
		removeRoot: (id) => files.removeRoot(string(id)),
		readDirectory: (id) => files.readDirectory(string(id)),
		readBytes: (id) => files.readBytes(string(id)),
		stat: (id) => files.stat(string(id)),
		saveText: (id, text, name, value) => {
			const opts = value === undefined ? undefined : object(value);
			if (
				opts?.expectedText !== undefined &&
				typeof opts.expectedText !== "string"
			)
				throw new Error("Invalid save baseline.");
			if (
				opts?.overwrite !== undefined &&
				typeof opts.overwrite !== "boolean"
			)
				throw new Error("Invalid overwrite option.");
			return files.saveText(
				window(),
				string(id),
				string(text),
				string(name),
				opts as
					| { expectedText?: string; overwrite?: boolean }
					| undefined,
			);
		},
		writeBytes: (id, data, stamp) => {
			if (!(data instanceof Uint8Array))
				throw new Error("Expected bytes.");
			return files.writeBytes(string(id), data, string(stamp));
		},
		create: (parent, name, kind) => {
			if (kind !== "file" && kind !== "directory")
				throw new Error("Invalid entry kind.");
			return files.create(string(parent), string(name), kind);
		},
		remove: (id, recursive) => {
			if (typeof recursive !== "boolean")
				throw new Error("Invalid remove option.");
			return files.remove(string(id), recursive);
		},
		move: (id, parent, name) =>
			files.move(string(id), string(parent), string(name)),
		exportText: (value) => {
			const file = object(value);
			return files.exportText(window(), {
				id: string(file.id),
				name: string(file.name),
				text: string(file.text),
			});
		},
	};
	registerMethods("files", methods, getWindow, origin);
}
export function registerMethods(
	prefix: string,
	methods: Record<string, (...args: unknown[]) => unknown>,
	getWindow: () => BrowserWindow | undefined,
	origin: string,
) {
	for (const [method, handle] of Object.entries(methods))
		ipcMain.handle(
			`${prefix}.${method}`,
			async (event, ...args: unknown[]) => {
				try {
					if (
						event.sender !== getWindow()?.webContents ||
						event.senderFrame !== event.sender.mainFrame ||
						(new URL(event.senderFrame.url).protocol === "celestie:"
							? `celestie://${new URL(event.senderFrame.url).host}`
							: new URL(event.senderFrame.url).origin) !== origin
					)
						throw new Error("Unauthorized IPC sender.");
					return { ok: true, value: await handle(...args) };
				} catch (error) {
					const value = error as { message?: string; code?: string };
					return {
						ok: false,
						error: {
							message: value?.message ?? String(error),
							code:
								typeof value?.code === "string"
									? value.code
									: undefined,
						},
					};
				}
			},
		);
}
