/// <reference types="vite/client" />

import { createPlaygroundDocuments } from "./documents";

const container = document.getElementById("editor");

if (!container) {
	throw new Error("Editor container was not found.");
}

const text = `// welcome to the playground

interface Task {
	id: number;
	title: string;
	completed: boolean;
}

const tasks: Task[] = [
	{ id: 1, title: "1", completed: true },
	{ id: 2, title: "2", completed: true },
	{ id: 3, title: "3", completed: false },
];

function completeTask(id: number): void {
	const task = tasks.find((item) => item.id === id);

	if (task) {
		task.completed = true;
	}
}

function getRemainingTasks(): Task[] {
	return tasks.filter((task) => !task.completed);
}

completeTask(1);
console.log(getRemainingTasks());
`;

const documents = createPlaygroundDocuments(container, text);
const view = documents.primary;
view.focus();

const commandsButton = document.getElementById("commands");
const tabSize = document.getElementById("tab-size") as HTMLSelectElement | null;
const insertSpaces = document.getElementById(
	"insert-spaces",
) as HTMLInputElement | null;
const readOnly = document.getElementById(
	"read-only",
) as HTMLInputElement | null;
const tabFocus = document.getElementById(
	"tab-focus",
) as HTMLInputElement | null;
const accessibleInput = document.getElementById(
	"accessible-input",
) as HTMLInputElement | null;
if (
	!commandsButton ||
	!tabSize ||
	!insertSpaces ||
	!readOnly ||
	!tabFocus ||
	!accessibleInput
)
	throw new Error("Editor settings were not found.");
tabSize.replaceChildren();
for (let size = 1; size <= 16; size++) {
	const option = document.createElement("option");
	option.value = String(size);
	option.textContent = String(size);
	tabSize.append(option);
}
const syncOptions = () => {
	const options = documents.activeView.getOptions();
	tabSize.value = String(options.tabSize);
	insertSpaces.checked = options.insertSpaces;
	readOnly.checked = options.readOnly;
	tabFocus.checked = options.tabFocusMode;
	accessibleInput.checked = options.accessibilitySupport === "on";
};
const changeOptions = () => {
	documents.activeView.updateOptions({
		tabSize: Number(tabSize.value),
		insertSpaces: insertSpaces.checked,
		readOnly: readOnly.checked,
		tabFocusMode: tabFocus.checked,
		accessibilitySupport: accessibleInput.checked ? "on" : "auto",
	});
	syncOptions();
};
const openCommands = () => documents.activeView.openCommandPalette();
commandsButton.addEventListener("click", openCommands);
for (const control of [
	tabSize,
	insertSpaces,
	readOnly,
	tabFocus,
	accessibleInput,
])
	control.addEventListener("change", changeOptions);
const optionsSubscription = documents.onDidChangeActiveView(syncOptions);
syncOptions();

const indentButton = document.getElementById("indent");
const outdentButton = document.getElementById("outdent");
const findButton = document.getElementById("find");
const goToButton = document.getElementById("go-to");
const lineCommentButton = document.getElementById("line-comment");
const blockCommentButton = document.getElementById("block-comment");
if (
	!indentButton ||
	!outdentButton ||
	!findButton ||
	!goToButton ||
	!lineCommentButton ||
	!blockCommentButton
)
	throw new Error("Indentation controls were not found.");

const indent = () => documents.activeView.indent();
const outdent = () => documents.activeView.outdent();
const find = () => documents.activeView.openFind();
const goTo = () => documents.activeView.openGoTo();
const lineComment = () => {
	documents.activeView.toggleLineComment();
	documents.activeView.focus();
};
const blockComment = () => {
	documents.activeView.toggleBlockComment();
	documents.activeView.focus();
};
const preserveSelection = (event: PointerEvent) => {
	if (event.button === 0) event.preventDefault();
};
indentButton.addEventListener("click", indent);
outdentButton.addEventListener("click", outdent);
findButton.addEventListener("click", find);
goToButton.addEventListener("click", goTo);
lineCommentButton.addEventListener("click", lineComment);
blockCommentButton.addEventListener("click", blockComment);
lineCommentButton.addEventListener("pointerdown", preserveSelection);
blockCommentButton.addEventListener("pointerdown", preserveSelection);
indentButton.addEventListener("pointerdown", preserveSelection);
outdentButton.addEventListener("pointerdown", preserveSelection);

import.meta.hot?.dispose(() => {
	commandsButton.removeEventListener("click", openCommands);
	for (const control of [
		tabSize,
		insertSpaces,
		readOnly,
		tabFocus,
		accessibleInput,
	])
		control.removeEventListener("change", changeOptions);
	optionsSubscription.dispose();
	indentButton.removeEventListener("click", indent);
	outdentButton.removeEventListener("click", outdent);
	findButton.removeEventListener("click", find);
	goToButton.removeEventListener("click", goTo);
	lineCommentButton.removeEventListener("click", lineComment);
	blockCommentButton.removeEventListener("click", blockComment);
	lineCommentButton.removeEventListener("pointerdown", preserveSelection);
	blockCommentButton.removeEventListener("pointerdown", preserveSelection);
	indentButton.removeEventListener("pointerdown", preserveSelection);
	outdentButton.removeEventListener("pointerdown", preserveSelection);
	documents.dispose();
});
