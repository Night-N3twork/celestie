import type { SignatureHelp } from "../api/language-contributions";
import { renderDocumentation } from "./documentation";
import type { LanguagePopup } from "./language-popup";
export function showSignatures(
	popup: LanguagePopup,
	result: string | SignatureHelp,
	offset: number,
): void {
	if (typeof result === "string") {
		popup.showText("Signature help", result, offset);
		return;
	}
	if (!result.signatures.length) return;
	let index = Math.max(
		0,
		Math.min(result.signatures.length - 1, result.activeSignature ?? 0),
	);
	const render = () => {
		const signature = result.signatures[index];
		if (!signature) return;
		const doc = popup.widget.ownerDocument,
			content = doc.createElement("div"),
			bar = doc.createElement("div"),
			label = doc.createElement("pre");
		for (const [name, delta] of [
			["Previous overload", -1],
			["Next overload", 1],
		] as const) {
			const button = doc.createElement("button");
			button.type = "button";
			button.textContent = name;
			button.onclick = () => {
				index =
					(index + delta + result.signatures.length) %
					result.signatures.length;
				render();
			};
			bar.append(button);
		}
		bar.append(
			doc.createTextNode(` ${index + 1}/${result.signatures.length}`),
		);
		const parameter =
				signature.parameters?.[
					signature.activeParameter ?? result.activeParameter ?? 0
				],
			range = parameter?.label;
		const from =
				typeof range === "string"
					? signature.label.indexOf(range)
					: (range?.[0] ?? -1),
			to =
				typeof range === "string"
					? from + range.length
					: (range?.[1] ?? -1);
		if (from >= 0 && to >= from && to <= signature.label.length) {
			label.append(doc.createTextNode(signature.label.slice(0, from)));
			const active = doc.createElement("mark");
			active.textContent = signature.label.slice(from, to);
			label.append(active, doc.createTextNode(signature.label.slice(to)));
		} else label.textContent = signature.label;
		content.append(bar, label);
		if (signature.documentation)
			content.append(renderDocumentation(doc, signature.documentation));
		if (parameter?.documentation)
			content.append(renderDocumentation(doc, parameter.documentation));
		popup.showContent("Signature help", content, offset, "signature");
	};
	render();
}
