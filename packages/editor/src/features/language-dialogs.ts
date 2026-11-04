import type { Analysis, LanguageContext, LanguageEdit } from "../api/languages";
import type { LanguageFeatureHost } from "./language-host";
import type { LanguagePopup } from "./language-popup";

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
export function showRename(
	dialog: DialogHost,
	context: LanguageContext,
	version: number,
): void {
	dialog.popup.close();
	const form = dialog.popup.widget.ownerDocument.createElement("form"),
		label = dialog.popup.widget.ownerDocument.createElement("label"),
		field = dialog.popup.widget.ownerDocument.createElement("input");
	label.textContent = "New symbol name";
	field.setAttribute("aria-label", "New symbol name");
	field.value =
		(context.text
			.slice(0, context.offset)
			.match(/[\p{ID_Continue}$]+$/u)?.[0] ?? "") +
		(context.text
			.slice(context.offset)
			.match(/^[\p{ID_Continue}$]+/u)?.[0] ?? "");
	label.append(field);
	form.append(label);
	form.onsubmit = (event) => {
		event.preventDefault();
		if (!/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(field.value)) {
			dialog.editor.announce("Enter a valid identifier.");
			return;
		}
		void dialog
			.request<readonly LanguageEdit[]>("rename", context, {
				name: field.value,
			})
			.then((edits) => {
				if (dialog.valid(context, version) && dialog.editor.canEdit()) {
					dialog.popup.close();
					dialog.editor.apply(edits);
					dialog.editor.input.focus({ preventScroll: true });
				}
			})
			.catch((error) => dialog.editor.announce(String(error)));
	};
	dialog.popup.widget.replaceChildren(form);
	dialog.popup.widget.hidden = false;
	dialog.popup.position(dialog.popup.widget, context.offset);
	field.focus();
	field.select();
}
export function showColorPicker(dialog: DialogHost): void {
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
	button.onclick = () => {
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
			dialog.editor.apply([
				{
					uri: model.uri.toString(),
					from: color.from,
					to: color.to,
					text,
					version,
				},
			]);
			dialog.popup.close();
			dialog.editor.input.focus({ preventScroll: true });
		}
	};
	dialog.popup.widget.replaceChildren(field, button);
	dialog.popup.widget.hidden = false;
	dialog.popup.position(dialog.popup.widget, color.from);
	field.focus();
}
