import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getLanguages, registerLanguage } from "../src/api/languages.ts";
import { embeddedLanguages, languageProfile } from "../src/languages/client.ts";
import { samples } from "./__language-samples.mjs";
const dir = "packages/editor/playground/dist/assets/";
const file = fs.readdirSync(dir).find((f) => f.startsWith("languages.worker-"));
const pending = new Map();
let seq = 0,
	count = 0;
globalThis.self = {
	postMessage: (m) => {
		const p = pending.get(m.id);
		if (p) {
			pending.delete(m.id);
			m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
		}
	},
};
await import(pathToFileURL(process.cwd() + "/" + dir + file).href);
const worker = globalThis.self;
const call = (method, extra = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		worker.onmessage({ data: { id, method, ...extra } });
	});
const check = (ok, label) => {
	count++;
	if (!ok) throw Error(label);
};
const sync = (language, text, id = "sample") =>
	call("sync", {
		document: {
			id,
			uri: "inmemory://" + id,
			text,
			version: ++seq,
			language,
			profile: languageProfile(language),
		},
	});
const analyze = (id = "sample") => call("analyze", { documentId: id });
const kindAt = (tokens, text, word, from = 0) => {
	const at = text.indexOf(word, from);
	return tokens.find((t) => t.from <= at && at < t.to)?.kind;
};
await call("languages", { languages: embeddedLanguages() });
const timings = [];
for (const language of getLanguages()) {
	const text = samples[language.id];
	check(text !== undefined, "Sample " + language.id);
	const start = performance.now();
	await sync(language.id, text);
	const a = await analyze();
	check(
		language.id === "plaintext"
			? a.tokens.length === 0
			: a.tokens.length > 0,
		"Highlight " + language.id,
	);
	check(
		a.tokens.every(
			(t) =>
				Number.isInteger(t.from) &&
				t.from >= 0 &&
				t.to > t.from &&
				t.to <= text.length,
		),
		"Offsets " + language.id,
	);
	check(
		a.diagnostics.length === 0 && a.symbols.length === 0,
		"No engine results " + language.id,
	);
	check(
		JSON.stringify((await analyze()).tokens) === JSON.stringify(a.tokens),
		"Cached " + language.id,
	);
	const edited = text + "\n";
	await sync(language.id, edited);
	const b = await analyze();
	await call("close", { documentId: "sample" });
	await sync(language.id, edited);
	check(
		JSON.stringify((await analyze()).tokens) === JSON.stringify(b.tokens),
		"Edited vs fresh " + language.id,
	);
	const words = text + "\nuniqueWord\nunique";
	await sync(language.id, words);
	check(
		(
			await call("complete", {
				documentId: "sample",
				offset: words.length,
			})
		).some((c) => c.label === "uniqueWord"),
		"Word completion " + language.id,
	);
	for (const method of [
		"definitions",
		"references",
		"rename",
		"format",
		"actions",
	])
		check(
			Array.isArray(
				await call(method, { documentId: "sample", offset: 0 }),
			),
			method + " " + language.id,
		);
	for (const method of ["hover", "signature", "resolveCompletion"])
		check(
			(await call(method, { documentId: "sample", offset: 0 })) === null,
			method + " " + language.id,
		);
	timings.push([language.id, Math.round(performance.now() - start)]);
}
for (const [language, text] of [
	["typescriptreact", 'const w = <div title="hello">Hello</div>;'],
	["javascriptreact", 'const w = <div title="hello">Hello</div>;'],
]) {
	await sync(language, text);
	check(
		kindAt((await analyze()).tokens, text, "div") !== undefined,
		"JSX grammar " + language,
	);
}
for (const [language, text, word] of [
	["yaml", 'key: "🙂"\n# trailing', "trailing"],
	["python", '"""first\nsecond"""\nx=1', "second"],
	["powershell", "<# first\nsecond #>\n$x=1", "second"],
	["c", "/* first\nsecond */\nint x;", "second"],
]) {
	await sync(language, text);
	const offset = text.indexOf(word);
	check(
		(await analyze()).tokens.some(
			(t) =>
				t.from <= offset &&
				t.to >= offset + word.length &&
				["string", "comment"].includes(t.kind),
		),
		"Multiline or unicode " + language,
	);
}
const md =
	"- item\n\n  ```py\n  def f(): return 1\n  ```\n\n~~~yml\nkey: value\n~~~\n\n```rs\nfn main() {}\n```\n\n```nope\nconst plain = 1\n```\n\n```c++\nint x;\n```\n\n```ts\nconst open = 1";
await sync("markdown", md);
const m = (await analyze()).tokens;
check(kindAt(m, md, "def") === "keyword", "indented py fence");
check(
	kindAt(m, md, "key") !== undefined && kindAt(m, md, "key") !== "string",
	"tilde yml fence",
);
check(kindAt(m, md, "fn") === "keyword", "rs extension fence");
check(kindAt(m, md, "const plain") !== "keyword", "unknown fence plain");
check(kindAt(m, md, "int") === "keyword", "c++ fence");
check(kindAt(m, md, "const open") === "keyword", "unclosed fence runs to end");
await sync("prompt", "```sh\necho hi\n```");
check(
	kindAt((await analyze()).tokens, "```sh\necho hi\n```", "echo") !==
		undefined,
	"markdown-family fence",
);
const brackets = 'f(a[{b}]) // (x)\n"(y)"';
await sync("c", brackets);
const bt = (await analyze()).tokens.filter((t) => t.kind.startsWith("bracket"));
check(
	bt.length === 6 && bt.every((t) => t.to <= brackets.indexOf("//")),
	"bracket depth outside comments/strings",
);
check(
	bt.map((t) => t.kind).join() ===
		"bracket0,bracket1,bracket2,bracket2,bracket1,bracket0",
	"bracket depth levels",
);
const custom = registerLanguage({
	id: "checklang",
	extensions: [".chk"],
	keywords: ["when"],
	configuration: {
		brackets: [["(", ")"]],
		quotes: ['"'],
		lineComment: "!",
		blockComment: ["<<", ">>"],
		colorizedBracketPairs: [["<", ">"]],
		wordPattern: /[\w-]+/,
	},
});
await call("languages", { languages: embeddedLanguages() });
const ct = 'when <a> (b) ! note\n<< block\nstill >> "s" my-word my';
await sync("checklang", ct, "custom");
const c = (await analyze("custom")).tokens;
check(kindAt(c, ct, "when") === "keyword", "fallback keywords");
check(
	kindAt(c, ct, "! note") === "comment" &&
		kindAt(c, ct, "still") === "comment",
	"fallback comments",
);
check(kindAt(c, ct, '"s"') === "string", "fallback strings");
check(
	kindAt(c, ct, "<") === "bracket0" && kindAt(c, ct, "(") === undefined,
	"colorized pairs override",
);
check(
	(await call("complete", { documentId: "custom", offset: ct.length })).some(
		(x) => x.label === "my-word",
	),
	"word pattern completion",
);
custom.dispose();
await sync("css", ".a { font-size: 1px; font-weight: 2 } font", "css");
check(
	(await call("complete", { documentId: "css", offset: 41 })).some(
		(x) => x.label === "font-size",
	),
	"css word completion",
);
await sync("rust", "//" + "x".repeat(600001), "large");
const large = await analyze("large");
check(large.tokens[0]?.kind === "comment", "large file lexical fallback");
let paused = false;
try {
	await call("complete", { documentId: "large", offset: 0 });
} catch {
	paused = true;
}
check(paused, "large file assistance paused");
console.log(
	JSON.stringify({
		assertions: count,
		languages: getLanguages().length,
		slowest: timings.sort((a, b) => b[1] - a[1]).slice(0, 6),
	}),
);
