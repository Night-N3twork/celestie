import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import type { ExplorerEntry } from "../platform/host";
import type { WorkspaceHost } from "../platform/services";
import type { WorkspaceDocument } from "../workspace/workspaceDocument";
import type { LanguageDocument, LanguageResponse } from "./protocol";
export function createLanguageService(options: {
	host: WorkspaceHost;
	roots: Accessor<ExplorerEntry[]>;
	documents: Accessor<readonly WorkspaceDocument[]>;
	revision: Accessor<number>;
}) {
	const [results, setResults] = createSignal(
		new Map<string, LanguageDocument>(),
	);
	const [status, setStatus] = createSignal("");
	let worker: Worker | undefined,
		timer: ReturnType<typeof setTimeout> | undefined,
		version = 0,
		disposed = false;
	const paths = new Map<string, string>();
	let projectFiles: { id: string; path: string; text: string }[] = [];
	let signature = "",
		scanVersion = 0;
	const scan = async (roots: ExplorerEntry[]) => {
		const generation = ++scanVersion,
			files: typeof projectFiles = [];
		paths.clear();
		let count = 0,
			bytes = 0;
		const visit = async (
			entry: ExplorerEntry,
			path: string,
		): Promise<void> => {
			if (generation !== scanVersion || disposed) return;
			if (++count > 3000 || bytes > 16 * 1024 * 1024) return;
			paths.set(entry.id, path);
			if (entry.kind === "directory") {
				if (
					[".git", "node_modules", "dist", ".next"].includes(
						entry.name,
					)
				)
					return;
				for (const child of await options.host.readDirectory(entry.id))
					await visit(child, `${path}/${child.name}`);
			} else if (/\.[cm]?[jt]sx?$|\/tsconfig\.json$/.test(path)) {
				const file = await options.host.readSearchFile(entry.id);
				if (file) {
					bytes += file.text.length * 2;
					files.push({ id: file.id, path, text: file.text });
				}
			}
		};
		try {
			for (let i = 0; i < roots.length; i++)
				await visit(roots[i], `/workspace${i}`);
			if (generation === scanVersion) {
				projectFiles = files;
				setStatus(
					count > 3000 || bytes > 16 * 1024 * 1024
						? "Project analysis limited to 3,000 entries / 16 MiB."
						: "",
				);
				schedule();
			}
		} catch (error) {
			if (generation === scanVersion)
				setStatus(`Project analysis: ${String(error)}`);
		}
	};
	const schedule = () => {
		clearTimeout(timer);
		const current = ++version;
		timer = setTimeout(() => {
			if (disposed) return;
			const documents = options.documents();
			if (
				!documents.some((document) =>
					/\.[cm]?[jt]sx?$/.test(document.name),
				)
			) {
				setResults(new Map());
				return;
			}
			worker ??= new Worker(
				new URL("./typescript.worker.ts", import.meta.url),
				{ type: "module" },
			);
			worker.onmessage = (event: MessageEvent<LanguageResponse>) => {
				if (event.data.version !== version) return;
				setResults(
					new Map(
						event.data.documents.map((document) => [
							document.id,
							document,
						]),
					),
				);
				if (event.data.error) setStatus(event.data.error);
			};
			worker.onerror = (event) =>
				setStatus(`Language worker: ${event.message}`);
			const files = new Map(projectFiles.map((file) => [file.id, file]));
			for (const document of documents)
				files.set(document.id, {
					id: document.id,
					path:
						paths.get(document.id) ??
						`/untitled/${document.id.replace(/[^\w.-]/g, "_")}/${document.name}`,
					text: document.editor.snapshot.text,
				});
			worker.postMessage({
				version: current,
				files: [...files.values()],
				open: documents.map((document) => document.id),
			});
		}, 250);
	};
	createEffect(() => {
		options.revision();
		const roots = options.roots(),
			next = JSON.stringify(roots.map((root) => root.id));
		if (next !== signature) {
			signature = next;
			void scan(roots);
		}
		schedule();
	});
	onCleanup(() => {
		disposed = true;
		scanVersion++;
		clearTimeout(timer);
		worker?.terminate();
	});
	return {
		results,
		status,
		refresh: () => scan(options.roots()),
		problems: () =>
			[...results().values()]
				.filter((result) =>
					options
						.documents()
						.some(
							(document) =>
								document.id === result.id &&
								document.editor.snapshot.text === result.text,
						),
				)
				.flatMap((result) => result.problems),
	};
}
