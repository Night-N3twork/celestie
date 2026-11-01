import type { FSBackend } from "@nightnetwork/dusk";

type Mutation = Parameters<Parameters<FSBackend["subscribe"]>[0]>[0];
const error = (code: string, message: string) =>
	Object.assign(new Error(message), { code });
function normalize(path: string) {
	if (!path.startsWith("/"))
		throw error("EINVAL", "Runtime paths must be absolute.");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	}
	return `/${parts.join("/")}`;
}
function filesystemError(cause: unknown) {
	const value = cause as {
		name?: string;
		code?: string | number;
		message?: string;
	};
	const codes: Record<string, string> = {
		NotFoundError: "ENOENT",
		TypeMismatchError: "ENOTDIR",
		InvalidModificationError: "ENOTEMPTY",
		NotAllowedError: "EACCES",
		NoModificationAllowedError: "EACCES",
		SecurityError: "EACCES",
	};
	return error(
		codes[value?.name ?? ""] ??
			(typeof value?.code === "string" ? value.code : "EIO"),
		value?.message ?? String(cause),
	);
}
export function workspaceFilesystem(fallback: FSBackend) {
	const mounts = new Map<string, FSBackend>(),
		listeners = new Set<(event: Mutation) => void>(),
		subscriptions = new Map<string, () => void>();
	const emit = (event: Mutation) => {
		for (const listener of listeners) listener(event);
	};
	fallback.subscribe(emit);
	const handles = new Map<number, { backend: FSBackend; handle: number }>();
	let nextHandle = 1000000000;
	const resolve = (path: string) => {
		const full = normalize(path),
			mount = [...mounts.keys()]
				.sort((a, b) => b.length - a.length)
				.find((root) => full === root || full.startsWith(`${root}/`));
		return mount
			? {
					backend: mounts.get(mount) as FSBackend,
					path: full.slice(mount.length) || "/",
				}
			: { backend: fallback, path: full };
	};
	const methods = new Set([
		"readFile",
		"writeFile",
		"readFileBytes",
		"writeFileBytes",
		"readdir",
		"mkdir",
		"rm",
		"exists",
		"stat",
		"rename",
		"openHandle",
		"readHandle",
		"writeHandle",
		"closeHandle",
		"fstatHandle",
		"ftruncateHandle",
		"fsyncHandle",
		"symlink",
		"readlink",
		"lstat",
	]);
	const fs = new Proxy({} as FSBackend, {
		get: (_, key) => {
			if (key === "subscribe")
				return (listener: (event: Mutation) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				};
			if (typeof key !== "string" || !methods.has(key)) return undefined;
			return async (...args: unknown[]) => {
				try {
					let backend = fallback;
					if (
						[
							"readHandle",
							"writeHandle",
							"closeHandle",
							"fstatHandle",
							"ftruncateHandle",
							"fsyncHandle",
						].includes(String(key))
					) {
						const record = handles.get(args[0] as number);
						if (!record)
							throw error("EBADF", "File handle is closed.");
						backend = record.backend;
						const id = args[0] as number;
						args[0] = record.handle;
						const method = backend[key as keyof FSBackend];
						if (typeof method !== "function")
							throw error(
								"ENOSYS",
								"Filesystem operation is unavailable.",
							);
						const result = await Reflect.apply(
							method,
							backend,
							args,
						);
						if (key === "closeHandle") handles.delete(id);
						return result;
					}
					const index = key === "symlink" ? 1 : 0,
						original = args[index] as string;
					const target = resolve(original);
					backend = target.backend;
					args[index] = target.path;
					if (key === "rename") {
						const destination = resolve(args[1] as string);
						if (destination.backend !== backend)
							throw error(
								"EXDEV",
								"Moving between workspace filesystems is unavailable.",
							);
						args[1] = destination.path;
					}
					const method = backend[key as keyof FSBackend];
					if (typeof method !== "function")
						throw error(
							"ENOSYS",
							"Filesystem operation is unavailable.",
						);
					const result = await Reflect.apply(method, backend, args);
					if (key === "openHandle") {
						const opened = result as Awaited<
								ReturnType<FSBackend["openHandle"]>
							>,
							id = nextHandle++;
						handles.set(id, { backend, handle: opened.handle });
						return { ...opened, handle: id };
					}
					if (key === "readdir") {
						const prefix = `${normalize(original).replace(/\/$/, "")}/`;
						const children = [...mounts.keys()]
							.filter((path) => path.startsWith(prefix))
							.map(
								(path) =>
									path.slice(prefix.length).split("/")[0],
							);
						return [
							...new Set([...(result as string[]), ...children]),
						];
					}
					return result;
				} catch (cause) {
					throw filesystemError(cause);
				}
			};
		},
	});
	const mount = (path: string, backend: FSBackend) => {
		const root = normalize(path);
		subscriptions.get(root)?.();
		mounts.set(root, backend);
		subscriptions.set(
			root,
			backend.subscribe((event) =>
				emit({
					...event,
					path: root + (event.path === "/" ? "" : event.path),
					previousPath: event.previousPath
						? root + event.previousPath
						: undefined,
				}),
			),
		);
	};
	return { fs, mount };
}
