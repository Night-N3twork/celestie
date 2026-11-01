import { Buffer } from "buffer";
import git from "isomorphic-git";

import { duskEnvironment, duskPath } from "../platform/dusk/environment";
import { gitFilesystem } from "./gitFilesystem";

Object.assign(globalThis, { Buffer });
export interface GitChange {
	path: string;
	head: number;
	worktree: number;
	stage: number;
}
export async function repository(root: string) {
	const { fs } = await duskEnvironment();
	return { fs: gitFilesystem(fs), dir: duskPath(root) };
}
export async function isRepository(root: string) {
	const { fs } = await duskEnvironment();
	return fs.exists(`${duskPath(root)}/.git`);
}
export async function changes(root: string): Promise<GitChange[]> {
	return (await git.statusMatrix(await repository(root)))
		.filter(
			([, head, worktree, stage]) =>
				head !== worktree || worktree !== stage,
		)
		.map(([path, head, worktree, stage]) => ({
			path,
			head,
			worktree,
			stage,
		}));
}
export async function initialize(root: string) {
	const { fs } = await duskEnvironment();
	if (await fs.exists(`${duskPath(root)}/.git`))
		throw new Error("This project already has a repository.");
	await git.init({ ...(await repository(root)), defaultBranch: "main" });
}
export async function stage(root: string, change: GitChange) {
	const options = await repository(root);
	if (change.worktree === 0)
		await git.remove({ ...options, filepath: change.path });
	else await git.add({ ...options, filepath: change.path });
}
export async function unstage(root: string, path: string) {
	await git.resetIndex({ ...(await repository(root)), filepath: path });
}
export async function diff(root: string, path: string, staged = false) {
	const options = await repository(root);
	let before = "";
	try {
		const oid = await git.resolveRef({ ...options, ref: "HEAD" });
		before = new TextDecoder().decode(
			(await git.readBlob({ ...options, oid, filepath: path })).blob,
		);
	} catch (error) {
		if (
			!["NotFoundError", "ResolveRefError"].includes(
				(error as { code?: string }).code ?? "",
			)
		)
			throw error;
	}
	const { fs } = await duskEnvironment(),
		full = `${options.dir}/${path}`;
	let indexText = "";
	await git.walk({
		...options,
		trees: [git.STAGE()],
		map: async (filepath, [entry]) => {
			if (filepath === path) {
				const oid = await entry?.oid();
				if (oid)
					indexText = new TextDecoder().decode(
						(await git.readBlob({ ...options, oid })).blob,
					);
				return null;
			}
			return filepath === "." || path.startsWith(`${filepath}/`)
				? undefined
				: null;
		},
	});
	return {
		before: staged ? before : indexText,
		after: staged
			? indexText
			: (await fs.exists(full))
				? await fs.readFile(full)
				: "",
	};
}
export async function commit(
	root: string,
	message: string,
	name: string,
	email: string,
) {
	if (!message.trim() || !name.trim() || !email.trim())
		throw new Error("Enter a commit message, author name, and email.");
	const changed = await changes(root);
	if (!changed.some((change) => change.head !== change.stage))
		throw new Error("Stage changes before committing.");
	return git.commit({
		...(await repository(root)),
		message: message.trim(),
		author: { name: name.trim(), email: email.trim() },
	});
}
