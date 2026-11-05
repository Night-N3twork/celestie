import {
	getLanguages,
	detectLanguage,
	registerLanguage,
} from "../src/api/languages.ts";
import { getLanguageConfiguration } from "../src/languages/configuration.ts";
import { TextModel } from "../src/model/text-model.ts";
import { samples } from "./__language-samples.mjs";
let count = 0;
const check = (ok, label) => {
	count++;
	if (!ok) throw Error(label);
};
for (const language of getLanguages()) {
	check(language.id in samples, "Sample " + language.id);
	for (const ext of language.extensions)
		check(
			detectLanguage("/work/sample" + ext) === language.id,
			"Extension " + ext + " " + detectLanguage("/work/sample" + ext),
		);
	for (const file of language.filenames ?? [])
		check(
			detectLanguage("/work/" + file) === language.id,
			"Filename " + file,
		);
	const configuration = getLanguageConfiguration(language.id);
	check(configuration.brackets.length > 0, "Configuration " + language.id);
	const path =
		language.filenames?.[0] ??
		"sample" + (language.extensions[0] ?? ".txt");
	const model = new TextModel(samples[language.id], {
		uri: "inmemory://work/" + path,
		register: false,
	});
	check(
		model.getLanguageId() === language.id ||
			[
				"dockercompose",
				"git-rebase",
				"chatagent",
				"instructions",
			].includes(language.id),
		"Model detection " + language.id + " " + model.getLanguageId(),
	);
	model.dispose();
}
for (const [path, language] of [
	["Dockerfile.dev", "dockerfile"],
	[".env.local", "dotenv"],
	["compose.prod.yaml", "dockercompose"],
	["docker-compose.yaml", "dockercompose"],
	["example.prompt.md", "prompt"],
	["example.instructions.md", "instructions"],
	["example.agent.md", "chatagent"],
	["SKILL.md", "skill"],
	["tsconfig.build.json", "jsonc"],
	["src/.github/hooks/run.json", "jsonc"],
	["src/.claude/rules/style.md", "instructions"],
	["src/.claude/rules/nested/style.md", "instructions"],
	["src/.github/agents/helper.md", "chatagent"],
	["User/snippets/typescript.json", "snippets"],
	["repo/.git/config", "properties"],
	["repo/rebase-merge/done", "git-rebase"],
	["server.log.1", "log"],
	["example.hpp.in", "cpp"],
	["example.tsx", "typescriptreact"],
	["example.jsx", "javascriptreact"],
	["example.mts", "typescript"],
	["example.cjs", "javascript"],
	["unknown.zzz", "plaintext"],
])
	check(
		detectLanguage(path) === language,
		"Pattern " + path + " " + detectLanguage(path),
	);
for (const [line, language] of [
	["#!/usr/bin/env python3", "python"],
	["#!/bin/bash", "shellscript"],
	["#!/bin/dash", "shellscript"],
	["#!/usr/bin/env mksh", "shellscript"],
	["# -*- mode: shell-script -*-", "shellscript"],
	["#!/usr/bin/env bun", "typescript"],
	["#!/usr/bin/env node", "javascript"],
	["#!/usr/bin/env ruby", "ruby"],
	["#!/usr/bin/env pwsh", "powershell"],
]) {
	check(detectLanguage("script", line) === language, "Shebang " + language);
	const model = new TextModel("\uFEFF" + line + "\n", { register: false });
	check(model.getLanguageId() === language, "Shebang model " + language);
	model.dispose();
}
const explicit = new TextModel("#!/bin/bash", {
	uri: "inmemory://test/file.py",
	languageId: "plaintext",
	register: false,
});
check(explicit.getLanguageId() === "plaintext", "Explicit override");
explicit.dispose();
const registration = registerLanguage({
	id: "custom",
	extensions: [".custom"],
	filenames: ["Customfile"],
	configuration: { brackets: [["(", ")"]], quotes: ['"'], lineComment: "!" },
});
check(detectLanguage("Customfile") === "custom", "Custom filename");
check(getLanguageConfiguration("custom").lineComment === "!", "Custom rules");
registration.dispose();
check(detectLanguage("Customfile") === "plaintext", "Custom disposal");
console.log(
	JSON.stringify({ registryAssertions: count, modes: getLanguages().length }),
);
