import type {
	ColorPresentation,
	RenamePreparation,
} from "../api/language-contributions";
import type {
	Analysis,
	LanguageContext,
	LanguageEdit,
	WorkspaceEdit,
} from "../api/languages";
import {
	getLanguageConfiguration,
	isWord,
	wordExpression,
} from "../languages/configuration";
import { validOffsetRange } from "./document-contributions";
import { wordRange } from "./editing-commands";
import type { LanguageFeatureHost } from "./language-host";
import type { LanguagePopup } from "./language-popup";
import { hasLanguageProvider } from "./language-request";

interface DialogHost {
	editor: LanguageFeatureHost;
	popup: LanguagePopup;
	analysis: Analysis;
	request<T>(
		method: string,
		context: LanguageContext,
		extra?: Record<string, unknown>,
	): Promise<T>;
	valid(context: LanguageContext, version: number): boolean;
}
export async function showRename(
	dialog: DialogHost,
	context: LanguageContext,
	version: number,
): Promise<void> {
	const prepared = hasLanguageProvider(context.model, "prepareRename");
	const preparation = prepared
		? await dialog.request<RenamePreparation | null>(
				"prepareRename",
				context,
			)
		: undefined;
	if (!dialog.valid(context, version)) return;
	if (
		prepared &&
		(!preparation ||
			preparation.reason ||
			!validOffsetRange(preparation, context.text.length))
	) {
		dialog.editor.announce(
			preparation?.reason ?? "This symbol cannot be renamed.",
		);
		return;
	}
	dialog.popup.close();
	const form = dialog.popup.widget.ownerDocument.createElement("form"),
		label = dialog.popup.widget.ownerDocument.createElement("label"),
		field = dialog.popup.widget.ownerDocument.createElement("input");
	label.textContent = "New symbol name";
	field.setAttribute("aria-label", "New symbol name");
	const configuration = getLanguageConfiguration(
		context.model.getLanguageId(),
	);
	const word = wordRange(
		context.text,
		context.offset,
		wordExpression(configuration),
	);
	field.value =
		preparation?.placeholder ??
		context.text.slice(
			preparation?.from ?? word.from,
			preparation?.to ?? word.to,
		);
	label.append(field);
	const submit = form.ownerDocument.createElement("button");
	submit.type = "submit";
	submit.textContent = "Rename";
	form.append(label, submit);
	form.onsubmit = (event) => {
		event.preventDefault();
		if (
			!field.value.trim() ||
			(!prepared && !isWord(configuration, field.value))
		) {
			dialog.editor.announce("Enter a single word.");
			return;
		}
		void dialog
			.request<readonly LanguageEdit[] | WorkspaceEdit>(
				"rename",
				context,
				{
					name: field.value,
				},
			)
			.then(async (edits) => {
				if (
					form.isConnected &&
					dialog.valid(context, version) &&
					dialog.editor.canEdit()
				) {
					dialog.popup.close();
					await dialog.editor.apply(edits);
					dialog.editor.input.focus({ preventScroll: true });
				}
			})
			.catch((error) => dialog.editor.announce(String(error)));
	};
	dialog.popup.showContent("Rename symbol", form, context.offset, "rename");
	field.focus();
	field.select();
}
export function showColorPicker(
	dialog: DialogHost,
	context: LanguageContext,
): void {
	const model = dialog.editor.model(),
		offset = dialog.editor.selection().end,
		color = dialog.analysis.colors?.find(
			(color) => offset >= color.from && offset <= color.to,
		);
	if (!model || !color) {
		dialog.editor.announce("No document color at the cursor.");
		return;
	}
	const version = model.getVersionId(),
		field = dialog.popup.widget.ownerDocument.createElement("input"),
		button = dialog.popup.widget.ownerDocument.createElement("button");
	field.type = "color";
	field.value = color.color.slice(0, 7);
	field.setAttribute("aria-label", "Color value");
	button.type = "button";
	button.textContent = "Apply color";
	button.onclick = async () => {
		if (
			dialog.editor.model() === model &&
			model.getVersionId() === version &&
			dialog.editor.canEdit()
		) {
			const original = model
					.getValue({ eol: "\n" })
					.slice(color.from, color.to),
				hex = field.value + color.color.slice(7),
				text = original.startsWith('"') ? JSON.stringify(hex) : hex;

			try {
				if (hasLanguageProvider(model, "colorPresentations")) {
					const presentations = await dialog.request<
						readonly ColorPresentation[]
					>("colorPresentations", context, {
						item: color,
						color: hex,
					});
					if (
						!button.isConnected ||
						!dialog.valid(context, version) ||
						!dialog.editor.canEdit()
					)
						return;
					dialog.popup.showChoices(
						"color-presentations",
						presentations.map((presentation) => ({
							label: presentation.label,
							run: () => {
								if (
									dialog.valid(context, version) &&
									dialog.editor.canEdit()
								)
									void Promise.resolve(
										dialog.editor.apply(presentation.edits),
									).catch((error) =>
										dialog.editor.announce(String(error)),
									);
							},
						})),
						offset,
					);
					return;
				}
				await dialog.editor.apply([
					{
						uri: model.uri.toString(),
						from: color.from,
						to: color.to,
						text,
						version,
					},
				]);
			} catch (error) {
				dialog.editor.announce(String(error));
				return;
			}

			dialog.popup.close();
			dialog.editor.input.focus({ preventScroll: true });
		}
	};
	const content = dialog.popup.widget.ownerDocument.createElement("div");
	content.append(field, button);
	dialog.popup.showContent("Document color", content, color.from, "color");
	field.focus();
}
