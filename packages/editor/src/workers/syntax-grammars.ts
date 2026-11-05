import "./grammar-environment";
import Prism from "prismjs/components/prism-core";
import "prismjs/components/prism-batch";
import "prismjs/components/prism-clojure";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-coffeescript";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-fsharp";
import "prismjs/components/prism-ignore";
import "prismjs/components/prism-go";
import "prismjs/components/prism-groovy";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-handlebars";
import "prismjs/components/prism-hlsl";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-properties";
import "prismjs/components/prism-java";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-json5";
import "prismjs/components/prism-julia";
import "prismjs/components/prism-latex";
import "prismjs/components/prism-less";
import "prismjs/components/prism-log";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-objectivec";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-php";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-pug";
import "prismjs/components/prism-python";
import "prismjs/components/prism-r";
import "prismjs/components/prism-cshtml";
import "prismjs/components/prism-rest";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-visual-basic";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";

const languages = Prism.languages;
languages.plain = {};
languages.cuda = languages.extend("cpp", {});
languages.insertBefore("cuda", "keyword", {
	"cuda-keyword": {
		pattern:
			/\b(?:__global__|__device__|__host__|__shared__|__constant__|__managed__|__launch_bounds__|threadIdx|blockIdx|blockDim|gridDim|warpSize)\b/,
		alias: "keyword",
	},
});
languages.dotenv = {
	comment: { pattern: /(^|\s)#.*/m, lookbehind: true },
	string: { pattern: /"(?:\\.|[^"\\])*"|'[^']*'/, greedy: true },
	keyword: /^export\b/m,
	property: /^[\w.-]+(?=\s*=)/m,
	variable: /\$\{[^}\r\n]+\}|\$\w+/,
	operator: /=/,
};
languages.bibtex = {
	comment: /%.*/,
	keyword: /@[a-z]+/i,
	property: /\b\w+(?=\s*=)/,
	string: { pattern: /"(?:\\.|[^"\\])*"/, greedy: true },
	number: /\b\d+\b/,
	punctuation: /[{},=]/,
};
languages.raku = {
	comment: /#.*/,
	string: {
		pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/,
		greedy: true,
	},
	keyword:
		/\b(?:use|unit|module|class|role|grammar|method|multi|sub|my|our|has|state|constant|say|given|when|default|for|loop|while|until|if|elsif|else|unless|with|without|return|is|does|True|False|Nil|Int|Str|Bool)\b/,
	variable: /[$@%&][.!*?^:]?[\w-]+/,
	number: /\b\d+(?:\.\d+)?\b/,
	punctuation: /[{}()[\];,]/,
};
languages["git-commit"] = {
	comment: /^#.*/m,
	keyword: /^(?:fixup!|squash!|amend!|Merge\b|Revert\b).*/m,
	string: /^[^#\r\n].*/,
};
languages["git-rebase"] = {
	comment: /^\s*#.*/m,
	keyword:
		/^(?:pick|p|reword|r|edit|e|squash|s|fixup|f|exec|x|break|b|drop|d|label|l|reset|t|merge|m|update-ref|u)\b/m,
	number: /\b[\da-f]{7,40}\b/,
};
languages["search-result"] = {
	comment: /^#.*$/m,
	keyword: /^\S[^\r\n]*:$/m,
	number: /^\s+\d+(?=[:,])/m,
};
languages.shaderlab = {
	comment: /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/,
	"shader-code": {
		pattern:
			/\b(?:CGPROGRAM|HLSLPROGRAM|CGINCLUDE|HLSLINCLUDE)\b[\s\S]*?\bEND(?:CG|HLSL)\b/,
		inside: languages.hlsl,
	},
	string: { pattern: /"(?:\\.|[^"\\])*"/, greedy: true },
	keyword:
		/\b(?:Shader|Properties|SubShader|Pass|Tags|LOD|Fallback|CustomEditor|UsePass|GrabPass|Blend|BlendOp|Cull|ZWrite|ZTest|ColorMask|Offset|Stencil|Range|Float|Int|Color|Vector|Queue|RenderType|Lighting|Material|Fog|SetTexture)\b/,
	number: /\b\d+(?:\.\d+)?\b/,
	punctuation: /[{}()[\];,]/,
};

const code = (languages.markdown as { code?: Prism.GrammarValue } | undefined)
	?.code;
if (Array.isArray(code)) {
	code.splice(1, 1);
	code.unshift({
		pattern:
			/^([ \t]*)(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n\1\2[`~]*[ \t]*$|(?![\s\S]))|(?![\s\S]))/m,
		greedy: true,
		inside: {
			"code-block": {
				pattern:
					/^([ \t]*(?:`{3,}|~{3,})[^\n]*\n)[\s\S]+?(?=\n[ \t]*(?:`{3,}|~{3,})[ \t]*$|(?![\s\S]))/,
				lookbehind: true,
			},
			"code-language": {
				pattern: /^([ \t]*(?:`{3,}|~{3,})[ \t]*)[^\s`~][^\n]*/,
				lookbehind: true,
			},
			punctuation: /`{3,}|~{3,}/,
		},
	});
}

export function hasGrammar(name: string): boolean {
	return name in languages && typeof languages[name] === "object";
}

export { Prism };
