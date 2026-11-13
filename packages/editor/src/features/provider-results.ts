function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}
function range(value: unknown, length = Number.MAX_SAFE_INTEGER): boolean {
	return (
		object(value) &&
		Number.isSafeInteger(value.from) &&
		Number.isSafeInteger(value.to) &&
		Number(value.from) >= 0 &&
		Number(value.to) >= Number(value.from) &&
		Number(value.to) <= length
	);
}
function list(value: unknown, valid: (value: unknown) => boolean): boolean {
	return Array.isArray(value) && value.length <= 100000 && value.every(valid);
}
function edit(value: unknown): boolean {
	return (
		range(value) &&
		object(value) &&
		typeof value.uri === "string" &&
		typeof value.text === "string" &&
		(value.version === undefined || Number.isSafeInteger(value.version))
	);
}
function workspace(value: unknown): boolean {
	return (
		object(value) &&
		list(value.edits, edit) &&
		(value.fileOperations === undefined ||
			list(
				value.fileOperations,
				(item) =>
					object(item) &&
					["create", "delete", "rename"].includes(
						String(item.kind),
					) &&
					typeof item.uri === "string" &&
					(item.kind !== "rename" || typeof item.newUri === "string"),
			))
	);
}
export function validateProviderResult(
	method: string,
	value: unknown,
	length: number,
): void {
	const location = (item: unknown) =>
		range(item) && object(item) && typeof item.uri === "string";
	let valid = true;
	switch (method) {
		case "complete": {
			const items =
				object(value) && !Array.isArray(value) ? value.items : value;
			valid = list(
				items,
				(item) =>
					range(item, length) &&
					object(item) &&
					typeof item.label === "string" &&
					typeof item.insertText === "string" &&
					(item.replaceTo === undefined ||
						(Number.isSafeInteger(item.replaceTo) &&
							Number(item.replaceTo) >= Number(item.to) &&
							Number(item.replaceTo) <= length)) &&
					(item.additionalEdits === undefined ||
						list(item.additionalEdits, edit)),
			);
			break;
		}
		case "definitions":
		case "references":
		case "declarations":
		case "typeDefinitions":
		case "implementations":
			valid = list(value, location);
			break;
		case "hover":
			valid =
				value === null ||
				(range(value, length) &&
					object(value) &&
					typeof value.text === "string");
			break;
		case "signature":
			valid =
				value === null ||
				typeof value === "string" ||
				(object(value) &&
					list(
						value.signatures,
						(item) =>
							object(item) && typeof item.label === "string",
					));
			break;
		case "rename":
		case "format":
		case "onTypeFormat":
			valid = Array.isArray(value) ? list(value, edit) : workspace(value);
			break;
		case "actions":
			valid = list(
				value,
				(item) =>
					workspace(item) &&
					object(item) &&
					typeof item.title === "string",
			);
			break;
		case "resolveAction":
			valid =
				value === null ||
				(workspace(value) &&
					object(value) &&
					typeof value.title === "string");
			break;
		case "resolveCompletion":
			valid =
				value === null ||
				(object(value) &&
					typeof value.detail === "string" &&
					list(value.edits, edit));
			break;
		case "documentHighlights":
		case "links":
			valid = list(value, (item) => range(item, length));
			break;
		case "linkedEditing":
			valid =
				value === null ||
				(object(value) &&
					list(value.ranges, (item) => range(item, length)));
			break;
		case "prepareRename":
			valid =
				value === null ||
				(object(value) &&
					(typeof value.reason === "string" || range(value, length)));
			break;
		case "inlineCompletions": {
			const items =
				object(value) && !Array.isArray(value) ? value.items : value;
			valid =
				list(
					items,
					(item) =>
						range(item, length) &&
						object(item) &&
						typeof item.insertText === "string",
				) &&
				(Array.isArray(value) ||
					(object(value) && typeof value.dispose === "function"));
			break;
		}
	}
	if (!valid) {
		releaseLate(method, value);
		throw new TypeError(`Invalid ${method} provider result.`);
	}
}
function releaseLate(method: string, value: unknown): void {
	if (
		method === "inlineCompletions" &&
		object(value) &&
		typeof value.dispose === "function"
	)
		try {
			value.dispose();
		} catch (error) {
			console.warn("Inline provider cleanup failed", error);
		}
}
export function awaitProviderResult(
	request: Promise<unknown>,
	signal: AbortSignal,
	method: string,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const abort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			reject(new DOMException("Cancelled", "AbortError"));
		};
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		request.then(
			(value) => {
				if (settled) {
					releaseLate(method, value);
					return;
				}
				settled = true;
				signal.removeEventListener("abort", abort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
