export type EditorWorkerKind = "language" | "search" | "diff";
export type EditorWorkerFactory = (kind: EditorWorkerKind) => Worker;
let factory: EditorWorkerFactory | undefined;
export function setEditorWorkerFactory(
	value: EditorWorkerFactory | undefined,
): void {
	if (value !== undefined && typeof value !== "function")
		throw new TypeError("Worker factory must be a function.");
	factory = value;
}
export function createEditorWorker(
	kind: EditorWorkerKind,
	fallback: () => Worker,
): Worker {
	return factory ? factory(kind) : fallback();
}
