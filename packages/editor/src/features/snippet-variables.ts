import type { TextSelection } from "../api/types";
import {
	getLanguageConfiguration,
	wordExpression,
} from "../languages/configuration";
import type { TextModel } from "../model/text-model";
import { wordRange } from "./editing-commands";

export function snippetVariables(
	model: TextModel,
	text: string,
	selection: TextSelection,
	cursor: number,
	date: Date,
): Record<string, string> {
	const position = model.getPositionAtInputOffset(selection.start),
		path = model.uri.path,
		filename = path.split("/").at(-1) ?? "";
	const word = wordRange(
		text,
		selection.start,
		wordExpression(getLanguageConfiguration(model.getLanguageId())),
	);
	const pad = (value: number) => String(value).padStart(2, "0");
	return {
		TM_SELECTED_TEXT: text.slice(selection.start, selection.end),
		TM_FILENAME: filename,
		TM_FILENAME_BASE: filename.replace(/\.[^.]+$/, ""),
		TM_DIRECTORY: path.slice(0, path.lastIndexOf("/")),
		TM_FILEPATH: path,
		TM_CURRENT_LINE: model.getLineContent(position.line),
		TM_CURRENT_WORD: text.slice(word.from, word.to),
		TM_LINE_INDEX: String(position.line - 1),
		TM_LINE_NUMBER: String(position.line),
		CURSOR_INDEX: String(cursor),
		CURSOR_NUMBER: String(cursor + 1),
		CURRENT_YEAR: String(date.getFullYear()),
		CURRENT_YEAR_SHORT: pad(date.getFullYear() % 100),
		CURRENT_MONTH: pad(date.getMonth() + 1),
		CURRENT_DATE: pad(date.getDate()),
		CURRENT_HOUR: pad(date.getHours()),
		CURRENT_MINUTE: pad(date.getMinutes()),
		CURRENT_SECOND: pad(date.getSeconds()),
		CURRENT_DAY_NAME: date.toLocaleDateString("en-US", { weekday: "long" }),
		CURRENT_DAY_NAME_SHORT: date.toLocaleDateString("en-US", {
			weekday: "short",
		}),
		CURRENT_MONTH_NAME: date.toLocaleDateString("en-US", { month: "long" }),
		CURRENT_MONTH_NAME_SHORT: date.toLocaleDateString("en-US", {
			month: "short",
		}),
		CURRENT_SECONDS_UNIX: String(Math.floor(date.getTime() / 1000)),
		CURRENT_TIMEZONE_OFFSET: `${date.getTimezoneOffset() <= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(date.getTimezoneOffset()) / 60))}:${pad(Math.abs(date.getTimezoneOffset()) % 60)}`,
		RANDOM: String(Math.floor(Math.random() * 1000000)).padStart(6, "0"),
		RANDOM_HEX: Math.floor(Math.random() * 0x1000000)
			.toString(16)
			.padStart(6, "0"),
		UUID: crypto.randomUUID(),
	};
}
