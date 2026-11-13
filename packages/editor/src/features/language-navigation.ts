import type {
	CodeAction,
	Diagnostic,
	LanguageContext,
	Location,
} from "../api/languages";
import { EmbeddedPreviews } from "./embedded-previews";
import type { LanguageFeatureHost } from "./language-host";
import type { LanguagePopup } from "./language-popup";
import { requestLanguage } from "./language-request";

export class LanguageNavigation {
	private locations: readonly Location[] = [];
	private readonly previews: EmbeddedPreviews;
	private index = -1;
	private diagnosticAbort = new AbortController();
	cancel(): void {
		this.diagnosticAbort.abort();
		this.diagnosticAbort = new AbortController();
	}
	clear(): void {
		this.locations = [];
		this.index = -1;
		this.cancel();
	}
	constructor(
		private readonly host: LanguageFeatureHost,
		private readonly popup: LanguagePopup,
	) {
		this.previews = new EmbeddedPreviews(host, popup);
	}
	async show(
		context: LanguageContext,
		method: string,
		peek: boolean,
	): Promise<void> {
		const version = context.model.getVersionId(),
			selection = JSON.stringify(this.host.selection());
		const locations = await requestLanguage<readonly Location[]>(
			method,
			context,
		);
		if (
			context.signal.aborted ||
			this.host.model() !== context.model ||
			context.model.getVersionId() !== version ||
			selection !== JSON.stringify(this.host.selection())
		)
			return;
		this.locations = locations;
		this.index = 0;
		if (peek && locations.length === 1 && locations[0]) {
			await this.previews.peek(context, locations[0]);
			return;
		}
		if (!peek && method !== "references" && locations.length === 1) {
			const location = locations[0];
			if (location) this.host.open(location);
			return;
		}
		const choices = await Promise.all(
			locations.map(async (location, index) => {
				const snapshot = await this.host
					.workspace()
					.resolve(location.uri, context.signal);
				let preview = location.preview ?? location.uri;
				if (snapshot) {
					const from = Math.max(
							0,
							Math.min(snapshot.text.length, location.from),
						),
						before =
							snapshot.text.lastIndexOf(
								"\n",
								Math.max(0, from - 1),
							) + 1,
						to = snapshot.text.indexOf("\n", location.to);
					preview = snapshot.text
						.slice(
							Math.max(0, before - 300),
							to < 0
								? Math.min(
										snapshot.text.length,
										location.to + 500,
									)
								: to,
						)
						.slice(0, 3000);
				}
				return {
					label: location.label ?? `${method} ${index + 1}`,
					detail: location.uri,
					preview,
					run: () => {
						this.index = index;
						if (peek)
							void this.previews
								.peek(context, location)
								.catch((error) =>
									this.host.announce(String(error)),
								);
						else this.host.open(location);
					},
				};
			}),
		);
		if (
			!context.signal.aborted &&
			this.host.model() === context.model &&
			context.model.getVersionId() === version &&
			selection === JSON.stringify(this.host.selection())
		)
			this.popup.showChoices(
				peek ? `peek-${method}` : method,
				choices,
				context.offset,
				true,
			);
	}
	next(direction: number): void {
		if (!this.locations.length) {
			this.host.announce("No navigation results.");
			return;
		}
		this.index =
			(this.index + direction + this.locations.length) %
			this.locations.length;
		const location = this.locations[this.index];
		if (location) this.host.open(location);
	}
	diagnostic(direction: number): void {
		const model = this.host.model();
		if (!model) return;
		const values = [...this.host.diagnostics()].sort(
				(a, b) => a.from - b.from || a.to - b.to,
			),
			offset = this.host.selection().end;
		const diagnostic =
			direction > 0
				? (values.find((item) => item.from > offset) ?? values[0])
				: ([...values].reverse().find((item) => item.from < offset) ??
					values.at(-1));
		if (!diagnostic) {
			this.host.announce("No diagnostics.");
			return;
		}
		this.host.open({
			uri: model.uri.toString(),
			from: diagnostic.from,
			to: diagnostic.to,
		});
		this.showDiagnostic(diagnostic);
	}
	private showDiagnostic(item: Diagnostic): void {
		const model = this.host.model();
		if (!model) return;
		this.popup.showChoices(
			"diagnostic",
			[
				{
					label: `${item.severity}: ${item.message}`,
					detail: [item.source, item.code, ...(item.tags ?? [])]
						.filter(Boolean)
						.join(" - "),
					preview: item.message,
					run: () => {
						this.host.open({
							uri: model.uri.toString(),
							from: item.from,
							to: item.to,
						});
					},
				},
				...(item.related ?? []).map((location) => ({
					label: location.message,
					detail: location.uri,
					preview: location.preview ?? "",
					run: () => this.host.open(location),
				})),
				...(item.codeDescription
					? [
							{
								label: "Diagnostic documentation",
								run: () =>
									this.host.openLink(
										item.codeDescription ?? "",
									),
							},
						]
					: []),
				{
					label: "Quick fixes",
					run: () => {
						void this.actions({
							model,
							text: model.getValue({ eol: "\n" }),
							offset: item.from,
							signal: this.diagnosticAbort.signal,
							workspace: this.host.workspace(),
						}).catch((error) => this.host.announce(String(error)));
					},
				},
			],
			item.from,
		);
		this.host.announce(item.message);
	}
	async actions(
		context: LanguageContext,
		kind?: string,
		preview = false,
	): Promise<void> {
		const version = context.model.getVersionId();
		const actions = await requestLanguage<readonly CodeAction[]>(
			"actions",
			context,
		);
		if (
			context.signal.aborted ||
			this.host.model() !== context.model ||
			context.model.getVersionId() !== version
		)
			return;
		const values = actions
			.filter(
				(action) =>
					!kind ||
					action.kind === kind ||
					action.kind?.startsWith(`${kind}.`),
			)
			.sort(
				(a, b) =>
					Number(!!a.disabled) - Number(!!b.disabled) ||
					Number(!!b.preferred) - Number(!!a.preferred) ||
					(a.kind ?? "").localeCompare(b.kind ?? ""),
			);
		this.popup.showChoices(
			kind ?? "actions",
			values.map((action) => ({
				label: `${action.preferred ? "★ " : ""}${action.title}`,
				detail: action.kind ?? "",
				...(action.disabled ? { disabled: action.disabled } : {}),
				preview: action.edits
					.map(
						(edit) =>
							`${edit.uri} [${edit.from}, ${edit.to}]\n${edit.text}`,
					)
					.join("\n\n")
					.slice(0, 4000),
				run: () => {
					void this.applyAction(
						context,
						version,
						action,
						preview || !!kind?.startsWith("refactor"),
					);
				},
			})),
			context.offset,
			true,
		);
	}
	private async applyAction(
		context: LanguageContext,
		version: number,
		action: CodeAction,
		preview: boolean,
	): Promise<void> {
		try {
			const resolved =
				(await requestLanguage<CodeAction | null>(
					"resolveAction",
					context,
					{ item: action },
				)) ?? action;
			if (
				context.signal.aborted ||
				this.host.model() !== context.model ||
				context.model.getVersionId() !== version ||
				!this.host.canEdit()
			)
				return;
			if (resolved.disabled) {
				this.host.announce(resolved.disabled);
				return;
			}
			if (preview)
				await this.previews.review(context, resolved.title, resolved);
			else await this.host.apply(resolved);
		} catch (error) {
			this.host.announce(String(error));
		}
	}
}
