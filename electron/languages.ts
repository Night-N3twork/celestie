import {
	type ChildProcessWithoutNullStreams,
	execFile,
	spawn,
} from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";
import {
	CancellationTokenSource,
	createMessageConnection,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type {
	Diagnostic,
	InitializeResult,
	PublishDiagnosticsParams,
	Range,
} from "vscode-languageserver-protocol";
import { languageId, type OpenDocument } from "../src/language/lsp";
import type { NativeWorkspace } from "./files";
import { registerMethods } from "./ipc";

interface Session {
	diagnostics: Map<string, Diagnostic[]>;
	child: ChildProcessWithoutNullStreams;
	connection: MessageConnection;
	ready: Promise<InitializeResult>;
	documents: Map<
		string,
		OpenDocument & { uri: string; serverVersion: number }
	>;
}
function sameUri(left: string, right: string) {
	try {
		const a = fileURLToPath(left),
			b = fileURLToPath(right);
		return process.platform === "win32"
			? a.toLowerCase() === b.toLowerCase()
			: a === b;
	} catch {
		return left === right;
	}
}
const methods = new Set([
	"textDocument/completion",
	"completionItem/resolve",
	"textDocument/hover",
	"textDocument/signatureHelp",
	"textDocument/definition",
	"textDocument/references",
	"textDocument/prepareRename",
	"textDocument/rename",
	"textDocument/formatting",
	"textDocument/codeAction",
	"codeAction/resolve",
]);

export class NativeLanguages {
	private generation = 0;
	private sessions = new Map<string, Session>();
	private queue: Promise<void> = Promise.resolve();
	constructor(
		private files: NativeWorkspace,
		private directory: string,
		private getWindow: () => BrowserWindow | undefined,
		origin: string,
	) {
		registerMethods(
			"languages",
			{
				sync: (documents) => {
					if (!Array.isArray(documents) || documents.length > 500)
						throw new Error("Invalid language documents.");
					for (const doc of documents)
						if (
							!doc ||
							typeof doc.id !== "string" ||
							typeof doc.name !== "string" ||
							typeof doc.text !== "string" ||
							!Number.isInteger(doc.version)
						)
							throw new Error("Invalid language document.");
					const next = this.queue
						.catch(() => {})
						.then(() => this.sync(documents));
					this.queue = next;
					return next;
				},
				request: async (id, method, params) => {
					if (
						typeof id !== "string" ||
						typeof method !== "string" ||
						(!methods.has(method) &&
							method !== "celestie/documentUri")
					)
						throw new Error("Unsupported language request.");
					if (
						params !== undefined &&
						(!params ||
							typeof params !== "object" ||
							Array.isArray(params))
					)
						throw new Error("Invalid request parameters.");
					await this.queue;
					for (const session of this.sessions.values()) {
						const doc = session.documents.get(id);
						if (!doc) continue;
						await session.ready;
						if (method === "celestie/documentUri") return doc.uri;
						const value = {
							...(params as Record<string, unknown>),
						};
						if (method.startsWith("textDocument/"))
							value.textDocument = { uri: doc.uri };
						if (method === "textDocument/codeAction") {
							const range = value.range as Range;
							value.context = {
								...(value.context as object),
								diagnostics: (
									session.diagnostics.get(id) ?? []
								).filter(
									(diagnostic) =>
										diagnostic.range.start.line <=
											range.end.line &&
										diagnostic.range.end.line >=
											range.start.line,
								),
							};
						}
						return this.request(session, method, value);
					}
					throw new Error(
						"No language server is available for this document. Open a supported file in a workspace folder.",
					);
				},
				fileId: (uri) => {
					if (typeof uri !== "string")
						throw new Error("Invalid URI.");
					return files.fileId(uri);
				},
				restart: () => this.close(),
			},
			getWindow,
			origin,
		);
	}
	private async request<T>(
		session: Session,
		method: string,
		params: unknown,
	): Promise<T> {
		const cancellation = new CancellationTokenSource();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				session.connection.sendRequest<T>(
					method,
					params,
					cancellation.token,
				),
				new Promise<T>((_resolve, reject) => {
					timer = setTimeout(() => {
						cancellation.cancel();
						reject(
							new Error(`Language request timed out: ${method}`),
						);
					}, 20000);
				}),
			]);
		} finally {
			clearTimeout(timer);
			cancellation.dispose();
		}
	}
	private start(key: string, server: string, cwd: string): Session {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
		};
		delete env.NODE_OPTIONS;
		const child = spawn(
			process.execPath,
			[
				path.join(
					this.directory,
					"servers",
					`${server}.${server === "typescript" ? "mjs" : "cjs"}`,
				),
				"--stdio",
			],
			{
				cwd,
				env,
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: "pipe",
			},
		);
		const connection = createMessageConnection(
			new StreamMessageReader(child.stdout),
			new StreamMessageWriter(child.stdin),
		);
		const session: Session = {
			diagnostics: new Map(),
			child,
			connection,
			documents: new Map(),
			ready: Promise.resolve({ capabilities: {} }),
		};
		this.sessions.set(key, session);
		connection.onRequest(
			"workspace/configuration",
			(params: { items: { section?: string }[] }) =>
				params.items.map(() => ({})),
		);
		connection.onRequest("client/registerCapability", () => null);
		connection.onRequest("client/unregisterCapability", () => null);
		connection.onRequest("window/workDoneProgress/create", () => null);
		connection.onRequest("workspace/applyEdit", () => ({
			applied: false,
			failureReason: "Apply the edit through the editor.",
		}));
		connection.onNotification(
			"textDocument/publishDiagnostics",
			(params: PublishDiagnosticsParams) => {
				const doc = [...session.documents.values()].find((doc) =>
					sameUri(doc.uri, params.uri),
				);
				if (
					!doc ||
					(params.version !== undefined &&
						params.version !== doc.serverVersion)
				)
					return;
				session.diagnostics.set(doc.id, params.diagnostics);
				const window = this.getWindow();
				if (window && !window.isDestroyed())
					window.webContents.send("languages.diagnostics", {
						id: doc.id,
						text: doc.text,
						diagnostics: params.diagnostics,
					});
			},
		);
		child.stderr.on("data", (data) =>
			console.error(`[${server}] ${String(data).trim()}`),
		);
		child.on("error", (error) =>
			console.error(`Language server: ${error.message}`),
		);
		child.on("exit", () => {
			connection.dispose();
			if (this.sessions.get(key) === session) this.sessions.delete(key);
		});
		connection.listen();
		session.ready = this.request<InitializeResult>(session, "initialize", {
			processId: process.pid,
			clientInfo: { name: "Celestie" },
			rootUri: pathToFileURL(cwd).href,
			workspaceFolders: [
				{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) },
			],
			capabilities: {
				general: { positionEncodings: ["utf-16"] },
				workspace: {
					configuration: true,
					workspaceFolders: true,
					workspaceEdit: { documentChanges: true },
				},
				textDocument: {
					synchronization: { didSave: true },
					completion: {
						completionItem: {
							snippetSupport: false,
							documentationFormat: ["plaintext"],
							resolveSupport: {
								properties: [
									"documentation",
									"detail",
									"additionalTextEdits",
								],
							},
						},
					},
					hover: { contentFormat: ["plaintext"] },
					signatureHelp: {
						signatureInformation: {
							documentationFormat: ["plaintext"],
						},
					},
					publishDiagnostics: { versionSupport: true },
					codeAction: {
						codeActionLiteralSupport: {
							codeActionKind: {
								valueSet: ["quickfix", "refactor", "source"],
							},
						},
					},
				},
			},
			initializationOptions:
				server === "typescript"
					? {
							hostInfo: "Celestie",
							tsserver: {
								path: path.join(
									this.directory,
									"node_modules/typescript/lib/tsserver.js",
								),
							},
							preferences: {
								includeCompletionsForModuleExports: true,
								includeCompletionsWithInsertText: true,
							},
						}
					: {},
		}).then(async (result) => {
			await connection.sendNotification("initialized", {});
			await connection.sendNotification(
				"workspace/didChangeConfiguration",
				{
					settings: {
						javascript: { validate: { enable: true } },
						typescript: { validate: { enable: true } },
						json: { validate: { enable: true } },
						css: { validate: true },
						html: { validate: true },
					},
				},
			);
			return result;
		});
		return session;
	}
	private async sync(documents: OpenDocument[]) {
		const generation = this.generation;
		const keep = new Set<string>();
		for (const doc of documents) {
			const language = languageId(doc.name);
			if (
				!language ||
				!doc.id.startsWith("native:") ||
				!doc.id.includes("/")
			)
				continue;
			const root = doc.id.split("/")[0];
			const server = /^(java|type)script/.test(language)
				? "typescript"
				: ["css", "scss", "less"].includes(language)
					? "css"
					: language === "jsonc"
						? "json"
						: language;
			const key = `${root}:${server}`;
			const uri = await this.files.uri(doc.id);
			const cwd = await this.files.workingDirectory(root);
			if (generation !== this.generation) return;
			const session =
				this.sessions.get(key) ?? this.start(key, server, cwd);
			await session.ready;
			if (generation !== this.generation) return;
			keep.add(doc.id);
			const before = session.documents.get(doc.id);
			if (!before) {
				session.documents.set(doc.id, {
					...doc,
					uri,
					serverVersion: 1,
				});
				await session.connection.sendNotification(
					"textDocument/didOpen",
					{
						textDocument: {
							uri,
							languageId: language,
							version: 1,
							text: doc.text,
						},
					},
				);
			} else if (before.text !== doc.text) {
				session.diagnostics.delete(doc.id);
				const serverVersion = before.serverVersion + 1;
				session.documents.set(doc.id, { ...doc, uri, serverVersion });
				await session.connection.sendNotification(
					"textDocument/didChange",
					{
						textDocument: { uri, version: serverVersion },
						contentChanges: [{ text: doc.text }],
					},
				);
			}
			if (
				before &&
				doc.saved &&
				(!before.saved || before.text !== doc.text)
			)
				await session.connection.sendNotification(
					"textDocument/didSave",
					{ textDocument: { uri }, text: doc.text },
				);
			const synced = session.documents.get(doc.id);
			if (synced) synced.saved = doc.saved;
		}
		for (const session of this.sessions.values())
			for (const [id, doc] of session.documents)
				if (!keep.has(id)) {
					await session.connection.sendNotification(
						"textDocument/didClose",
						{ textDocument: { uri: doc.uri } },
					);
					session.documents.delete(id);
					session.diagnostics.delete(id);
				}
	}
	async close() {
		this.generation++;
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(
			sessions.map(async (session) => {
				session.connection.dispose();
				const pid = session.child.pid;
				if (!pid || session.child.exitCode !== null) return;
				if (process.platform === "win32") {
					await promisify(execFile)(
						path.join(
							process.env.SystemRoot || "C:\\Windows",
							"System32/taskkill.exe",
						),
						["/pid", String(pid), "/t", "/f"],
						{ windowsHide: true },
					).catch(() => {});
				} else {
					try {
						process.kill(-pid, "SIGKILL");
					} catch {}
				}
			}),
		);
	}
}
