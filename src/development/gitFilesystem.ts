import type { FSBackend } from "@nightnetwork/dusk";

export function gitFilesystem(fs: FSBackend) {
	const stat = async (path: string) => {
		const value = await fs.stat(path);
		return {
			...value,
			mode: value.isDirectory ? 0o40755 : 0o100644,
			uid: 0,
			gid: 0,
			ino: 0,
			dev: 0,
			isFile: () => value.isFile,
			isDirectory: () => value.isDirectory,
			isSymbolicLink: () => false,
		};
	};
	return {
		promises: {
			async readFile(
				path: string,
				options?: { encoding?: string } | string,
			) {
				const bytes = await fs.readFileBytes(path);
				return options === "utf8" ||
					(typeof options === "object" && options.encoding)
					? new TextDecoder().decode(bytes)
					: bytes;
			},
			writeFile: (path: string, data: Uint8Array | string) =>
				typeof data === "string"
					? fs.writeFile(path, data)
					: fs.writeFileBytes(path, data),
			unlink: (path: string) => fs.rm(path),
			rmdir: (path: string) => fs.rm(path),
			mkdir: (path: string) => fs.mkdir(path),
			readdir: (path: string) => fs.readdir(path),
			stat,
			lstat: stat,
			readlink: (path: string) => {
				if (!fs.readlink) throw new Error("Symlinks are unavailable.");
				return fs.readlink(path);
			},
			symlink: (target: string, path: string) => {
				if (!fs.symlink) throw new Error("Symlinks are unavailable.");
				return fs.symlink(target, path);
			},
		},
	};
}
