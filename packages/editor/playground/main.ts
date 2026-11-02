/// <reference types="vite/client" />

import { TextModel } from "../src/model/text-model";
import { EditorView } from "../src/view/editor-view";

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

const model = new TextModel(text);
const view = new EditorView(container, model);
view.focus();

const indentButton = document.getElementById("indent");
const outdentButton = document.getElementById("outdent");
const findButton = document.getElementById("find");
if (!indentButton || !outdentButton || !findButton)
	throw new Error("Indentation controls were not found.");

const indent = () => view.indent();
const outdent = () => view.outdent();
const find = () => view.openFind();
const preserveSelection = (event: PointerEvent) => {
	if (event.button === 0) event.preventDefault();
};
indentButton.addEventListener("click", indent);
outdentButton.addEventListener("click", outdent);
findButton.addEventListener("click", find);
indentButton.addEventListener("pointerdown", preserveSelection);
outdentButton.addEventListener("pointerdown", preserveSelection);

import.meta.hot?.dispose(() => {
	indentButton.removeEventListener("click", indent);
	outdentButton.removeEventListener("click", outdent);
	findButton.removeEventListener("click", find);
	indentButton.removeEventListener("pointerdown", preserveSelection);
	outdentButton.removeEventListener("pointerdown", preserveSelection);
	view.dispose();
	model.dispose();
});
