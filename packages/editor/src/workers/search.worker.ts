import type {
	RegexSearchRequest,
	RegexSearchResponse,
} from "../features/regex-search";
import { findPatternMatches } from "../features/search";

const channel = globalThis as unknown as {
	onmessage: (event: MessageEvent<RegexSearchRequest>) => void;
	postMessage(response: RegexSearchResponse): void;
};
channel.onmessage = ({ data }) => {
	try {
		const pattern = new RegExp(
			data.query,
			data.options.matchCase === false ? "gimu" : "gmu",
		);
		const result = findPatternMatches(
			data.text,
			pattern,
			data.options,
			10000,
			true,
		);
		channel.postMessage({ id: data.id, ...result });
	} catch (error) {
		channel.postMessage({
			id: data.id,
			matches: [],
			truncated: false,
			error:
				error instanceof Error
					? error.message
					: "Invalid regex pattern.",
		});
	}
};
