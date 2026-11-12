import "../src/styles/editor.css";
import { DiffEditorView, ModelRegistry, Uri } from "../src";

const container = document.getElementById("diff");
if (!container) throw new Error("Diff container missing.");
const registry = new ModelRegistry();
const context = Array.from(
	{ length: 35 },
	(_, index) => `// Unchanged context ${index + 1}`,
).join("\n");
const original = registry.createModel(
	`interface Task {\n\tid: number;\n\ttitle: string;\n}\n\n${context}\n\nexport function describe(task: Task): string {\n\treturn task.title;\n}\n`,
	{ uri: Uri.parse("inmemory://diff/original.ts"), languageId: "typescript" },
);
const modified = registry.createModel(
	`interface Task {\n\tid: number;\n\ttitle: string;\n\tcompleted: boolean;\n}\n\n${context}\n\nexport function describe(task: Task): string {\n\treturn task.completed ? task.title : \`Pending: \${task.title}\`;\n}\n`,
	{ uri: Uri.parse("inmemory://diff/modified.ts"), languageId: "typescript" },
);
const diff = new DiffEditorView(
	container,
	{ original, modified },
	{
		originalLabel: "Original - read-only",
		modifiedLabel: "Modified - editable",
		editorOptions: { minimap: false, theme: "dark" },
	},
);
window.addEventListener(
	"pagehide",
	() => {
		diff.dispose();
		registry.dispose();
	},
	{ once: true },
);
