import { getLanguages } from "../src/api/languages";
import { Uri } from "../src/api/uri";
import { Emitter } from "../src/model/events";
import { ModelRegistry } from "../src/model/model-registry";
import type { EndOfLine, TextModel } from "../src/model/text-model";
import { EditorView } from "../src/view/editor-view";

export function createPlaygroundDocuments(
	container: HTMLElement,
	initialText: string,
) {
	const registry = new ModelRegistry();
	const models = [
		registry.createModel(initialText, {
			uri: Uri.parse("inmemory://playground/example.ts"),
			languageId: "typescript",
		}),
		registry.createModel(
			"# Notes\n\nEach document keeps its own text and undo history.",
			{ uri: Uri.parse("inmemory://playground/notes.txt") },
		),
		registry.createModel(
			'\uFEFFconst café = "🙂";\r\n\t// CRLF, a BOM, and Unicode are preserved.\r\n',
			{
				uri: Uri.parse("inmemory://playground/unicode.ts"),
				languageId: "typescript",
			},
		),
	];
	models.push(
		registry.createModel(
			".card {\n\tcolor: #75beff;\n\tpadding: 16px;\n}\n",
			{
				uri: Uri.parse("inmemory://playground/styles.css"),
				languageId: "css",
			},
		),
		registry.createModel(
			'<main class="card">\n\t<h1>Hello editor</h1>\n</main>\n',
			{
				uri: Uri.parse("inmemory://playground/index.html"),
				languageId: "html",
			},
		),
		registry.createModel(
			'{\n\t"name": "Celestie",\n\t"enabled": true\n}\n',
			{
				uri: Uri.parse("inmemory://playground/settings.json"),
				languageId: "json",
			},
		),
	);
	models.push(
		registry.createModel(
			"export function sum(left: number, right: number): number {\n\treturn left + right;\n}\n",
			{
				uri: Uri.parse("inmemory://playground/utilities.ts"),
				languageId: "typescript",
			},
		),
	);
	const primary = new EditorView(container, models[0] as TextModel);
	let secondary: EditorView | undefined;
	let active = primary;
	const changed = new Emitter<EditorView>();
	const selector = document.getElementById("document") as HTMLSelectElement;
	const secondSelector = document.getElementById(
		"second-document",
	) as HTMLSelectElement;
	const split = document.getElementById("second-view") as HTMLInputElement;
	const second = document.getElementById("second-editor") as HTMLDivElement;
	const panes = document.getElementById("editor-panes") as HTMLDivElement;
	const eol = document.getElementById("line-endings") as HTMLSelectElement;
	const language = document.getElementById("language") as HTMLSelectElement;
	language.replaceChildren(
		...getLanguages().map((definition) => {
			const option = document.createElement("option");
			option.value = definition.id;
			option.textContent = definition.name ?? definition.id;
			return option;
		}),
	);
	const title = document.getElementById("file-title") as HTMLHeadingElement;
	const status = document.getElementById(
		"document-status",
	) as HTMLSpanElement;
	const clean = new Map(
		models.map((model) => [model, model.getAlternativeVersionId()]),
	);
	split.checked = false;
	second.hidden = true;
	secondSelector.parentElement?.setAttribute("hidden", "");
	panes.classList.remove("has-second");
	const label = (model: TextModel) =>
		model.uri.path.split("/").at(-1) ?? model.id;
	const update = () => {
		for (const [select, view] of [
			[selector, primary],
			[secondSelector, secondary],
		] as const) {
			select.replaceChildren();
			const empty = document.createElement("option");
			empty.value = "";
			empty.textContent = "No document";
			select.append(empty);
			for (const model of registry.getModels()) {
				const option = document.createElement("option");
				option.value = model.uri.toString();
				option.textContent =
					label(model) +
					(clean.get(model) !== model.getAlternativeVersionId()
						? " •"
						: "");
				select.append(option);
			}
			select.value = view?.getModel()?.uri.toString() ?? "";
		}
		const model = active.getModel();
		title.textContent = primary.getModel()
			? label(primary.getModel() as TextModel)
			: "No document";
		eol.disabled = !model || active.getOptions().readOnly;
		language.disabled = !model;
		if (model) {
			eol.value =
				model.getEOL() === "\r\n"
					? "CRLF"
					: model.getEOL() === "\r"
						? "CR"
						: "LF";
			language.value = model.getLanguageId();
			status.textContent = `${clean.get(model) !== model.getAlternativeVersionId() ? "Modified" : "Unmodified"}${model.getBOM() ? " · BOM" : ""}`;
		} else status.textContent = "No document attached";
	};
	const primaryFocus = () => {
		active = primary;
		update();
		changed.emit(active);
	};
	const secondFocus = () => {
		if (secondary) {
			active = secondary;
			update();
			changed.emit(active);
		}
	};
	const selectPrimary = () => {
		primary.setModel(
			selector.value ? registry.getModel(selector.value) : null,
		);
		primary.focus();
		primaryFocus();
	};
	const selectSecond = () => {
		secondary?.setModel(
			secondSelector.value
				? registry.getModel(secondSelector.value)
				: null,
		);
		secondary?.focus();
		secondFocus();
	};
	let secondaryOptions: { dispose(): void } | undefined;
	let secondaryModel: { dispose(): void } | undefined;
	const toggleSecond = () => {
		secondaryOptions?.dispose();
		secondaryModel?.dispose();
		secondaryOptions = undefined;
		secondaryModel = undefined;
		if (split.checked) {
			second.hidden = false;
			secondSelector.parentElement?.removeAttribute("hidden");
			panes.classList.add("has-second");
			secondary = new EditorView(
				second,
				primary.getModel() ?? (models[0] as TextModel),
				{ ariaLabel: "Second editor" },
			);
			if (!primary.getModel()) secondary.setModel(null);
			secondaryModel = secondary.onDidChangeModel(update);
			secondaryOptions = secondary.onDidChangeOptions(() => {
				update();
				changed.emit(active);
			});
		} else {
			if (active === secondary) active = primary;
			secondary?.dispose();
			secondary = undefined;
			second.hidden = true;
			secondSelector.parentElement?.setAttribute("hidden", "");
			panes.classList.remove("has-second");
		}
		update();
		changed.emit(active);
	};
	const changeEOL = () => {
		if (!active.getOptions().readOnly)
			active
				.getModel()
				?.setEOL(
					({ LF: "\n", CRLF: "\r\n", CR: "\r" } as const)[
						eol.value as "LF" | "CRLF" | "CR"
					] as EndOfLine,
				);
		active.focus();
		update();
	};
	const changeLanguage = () => {
		active.getModel()?.setLanguageId(language.value);
		active.focus();
		update();
	};
	container.addEventListener("focusin", primaryFocus);
	second.addEventListener("focusin", secondFocus);
	selector.addEventListener("change", selectPrimary);
	secondSelector.addEventListener("change", selectSecond);
	split.addEventListener("change", toggleSecond);
	eol.addEventListener("change", changeEOL);
	language.addEventListener("change", changeLanguage);
	const subscriptions = models.flatMap((model) => [
		model.onDidChangeContent(update),
		model.onDidChangeLanguage(update),
		model.onDidChangeOptions(update),
	]);
	subscriptions.push(
		registry.onWillDisposeModel(update),
		primary.onDidChangeModel(update),
		primary.onDidChangeOptions(() => {
			update();
			changed.emit(active);
		}),
	);
	update();
	return {
		primary,
		get activeView() {
			return active;
		},
		onDidChangeActiveView: (listener: (view: EditorView) => void) =>
			changed.on(listener),
		dispose: () => {
			container.removeEventListener("focusin", primaryFocus);
			second.removeEventListener("focusin", secondFocus);
			selector.removeEventListener("change", selectPrimary);
			secondSelector.removeEventListener("change", selectSecond);
			split.removeEventListener("change", toggleSecond);
			eol.removeEventListener("change", changeEOL);
			language.removeEventListener("change", changeLanguage);
			for (const subscription of subscriptions) subscription.dispose();
			secondaryOptions?.dispose();
			secondaryModel?.dispose();
			changed.dispose();
			secondary?.dispose();
			primary.dispose();
			registry.dispose();
		},
	};
}
