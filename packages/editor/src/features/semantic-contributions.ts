import type {
	SemanticTokenDelta,
	SemanticTokenSnapshot,
} from "../api/language-contributions";
import type { LanguageContext, Token } from "../api/languages";
import type { TextModel } from "../model/text-model";
import { requestLanguage } from "./language-request";

export class SemanticContributions {
	private snapshots = new WeakMap<TextModel, SemanticTokenSnapshot>();
	clear(): void {
		this.snapshots = new WeakMap();
	}
	async request(
		context: LanguageContext,
	): Promise<readonly Token[] | undefined> {
		const previous = this.snapshots.get(context.model),
			version = context.model.getVersionId();
		const result = await requestLanguage<
			| readonly Token[]
			| SemanticTokenSnapshot
			| SemanticTokenDelta
			| undefined
		>("semanticTokens", {
			...context,
			...(previous?.resultId !== undefined
				? { previousSemanticResultId: previous.resultId }
				: {}),
		});
		if (result === undefined) return undefined;
		let snapshot: SemanticTokenSnapshot;
		if ("edits" in result) {
			if (previous?.resultId === undefined)
				throw new Error(
					"Semantic token deltas require a previous result id.",
				);
			const tokens: Token[] = [];
			let end = 0;
			for (const edit of result.edits) {
				if (
					!Number.isInteger(edit.start) ||
					!Number.isInteger(edit.deleteCount) ||
					edit.start < end ||
					edit.deleteCount < 0 ||
					edit.start + edit.deleteCount > previous.tokens.length
				)
					throw new Error("Invalid semantic token delta.");
				for (const token of previous.tokens.slice(end, edit.start))
					tokens.push(token);
				for (const token of edit.tokens ?? []) tokens.push(token);
				end = edit.start + edit.deleteCount;
			}
			for (const token of previous.tokens.slice(end)) tokens.push(token);
			snapshot = { resultId: result.resultId, tokens };
		} else snapshot = "tokens" in result ? result : { tokens: result };
		let end = 0;
		for (const token of snapshot.tokens) {
			if (
				!Number.isInteger(token.from) ||
				!Number.isInteger(token.to) ||
				token.from < end ||
				token.to <= token.from ||
				token.to > context.text.length
			)
				throw new Error("Invalid semantic token range.");
			end = token.to;
		}
		if (
			!context.signal.aborted &&
			!context.model.isDisposed() &&
			context.model.getVersionId() === version
		)
			this.snapshots.set(context.model, snapshot);
		return snapshot.tokens;
	}
}
