import type { FileHost, TextFile } from "../host";

interface FileHandle {
	getFile(): Promise<File>;
	createWritable(): Promise<{
		write(text: string): Promise<void>;
		close(): Promise<void>;
	}>;
}
interface PickerWindow {
	showOpenFilePicker?: () => Promise<FileHandle[]>;
	showSaveFilePicker?: (options: {
		suggestedName: string;
	}) => Promise<FileHandle>;
}

export class BrowserFileHost implements FileHost {
	private handles = new Map<string, FileHandle>();
	private names = new Map<string, string>();
	private get pickers() {
		return window as unknown as PickerWindow;
	}

	remember(file: Pick<TextFile, "id" | "name">): void {
		this.names.set(file.id, file.name);
	}

	async openTextFile(): Promise<TextFile | undefined> {
		try {
			let file: File;
			let handle: FileHandle | undefined;
			if (this.pickers.showOpenFilePicker) {
				[handle] = await this.pickers.showOpenFilePicker();
				if (!handle) return;
				file = await handle.getFile();
			} else {
				const selected = await new Promise<File | undefined>(
					(resolve) => {
						const input = document.createElement("input");
						input.type = "file";
						input.onchange = () => resolve(input.files?.[0]);
						input.oncancel = () => resolve(undefined);
						input.click();
					},
				);
				if (!selected) return;
				file = selected;
			}
			const result = {
				id: crypto.randomUUID(),
				name: file.name,
				text: await file.text(),
			};
			this.remember(result);
			if (handle) this.handles.set(result.id, handle);
			return result;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				return;
			throw error;
		}
	}

	async saveTextFile(id: string, text: string): Promise<void> {
		let handle = this.handles.get(id);
		if (!handle) {
			if (!this.pickers.showSaveFilePicker) {
				throw new Error(
					"Saving is unavailable in this browser. Use Download copy.",
				);
			}
			handle = await this.pickers.showSaveFilePicker({
				suggestedName: this.names.get(id) ?? "untitled.txt",
			});
			this.handles.set(id, handle);
		}
		const writable = await handle.createWritable();
		await writable.write(text);
		await writable.close();
	}

	download(file: TextFile): void {
		const url = URL.createObjectURL(
			new Blob([file.text], { type: "text/plain;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = file.name;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
