async function database(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open("celestie.files", 1);
		request.onupgradeneeded = () =>
			request.result.createObjectStore("folders");
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function readFolder<T>(): Promise<T | undefined> {
	const db = await database();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const request = db
				.transaction("folders")
				.objectStore("folders")
				.get("selected");
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

export async function writeFolder<T>(folder: T): Promise<void> {
	const db = await database();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction("folders", "readwrite");
			transaction.oncomplete = () => resolve();
			transaction.onabort = () =>
				reject(
					transaction.error ??
						new Error("Folder storage was aborted"),
				);
			transaction.onerror = () => reject(transaction.error);
			transaction.objectStore("folders").put(folder, "selected");
		});
	} finally {
		db.close();
	}
}
