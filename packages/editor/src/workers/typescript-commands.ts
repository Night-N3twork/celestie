import ts from "typescript";
import type { CodeAction, Hover } from "../api/languages";
import type {
	LanguageDocument as Document,
	LanguageRequest as Request,
} from "./language-protocol";
import { analyze } from "./typescript-analysis";
import { typescriptCompletions } from "./typescript-completions";
import {
	canApplyChanges,
	edits,
	location,
	typescriptContext,
} from "./typescript-edits";
import { lookup, service } from "./typescript-host";
export function typescriptLanguage(
	request: Request,
	document: Document,
): unknown {
	const { offset, file, supported, settings } = typescriptContext(
		request,
		document,
	);
	if (request.method === "analyze") return analyze(document, request);
	if (request.method === "complete" || request.method === "resolveCompletion")
		return typescriptCompletions(request, document);
	if (request.method === "hover") {
		const info = supported
			? service.getQuickInfoAtPosition(file, offset)
			: undefined;
		return info
			? ({
					from: info.textSpan.start,
					to: info.textSpan.start + info.textSpan.length,
					text:
						ts.displayPartsToString(info.displayParts) +
						"\n" +
						ts.displayPartsToString(info.documentation),
				} satisfies Hover)
			: null;
	}
	if (request.method === "signature") {
		const info = supported
			? service.getSignatureHelpItems(file, offset, undefined)
			: undefined;
		const item = info?.items[info.selectedItemIndex];
		return item
			? ts.displayPartsToString(item.prefixDisplayParts) +
					item.parameters
						.map(
							(parameter, index) =>
								`${index === info?.argumentIndex ? "▸ " : ""}${ts.displayPartsToString(parameter.displayParts)}`,
						)
						.join(
							ts.displayPartsToString(item.separatorDisplayParts),
						) +
					ts.displayPartsToString(item.suffixDisplayParts)
			: null;
	}
	if (request.method === "definitions")
		return supported
			? (service.getDefinitionAtPosition(file, offset) ?? []).map(
					(definition) => ({
						...location(definition.fileName, definition.textSpan),
						label: definition.name,
					}),
				)
			: [];
	if (request.method === "references")
		return supported
			? (service.getReferencesAtPosition(file, offset) ?? []).map(
					(reference) =>
						location(reference.fileName, reference.textSpan),
				)
			: [];
	if (request.method === "rename") {
		if (!supported)
			throw new Error("No rename provider for this language.");
		const info = service.getRenameInfo(file, offset, {
			allowRenameOfImportPath: false,
		});
		if (!info.canRename) throw new Error(info.localizedErrorMessage);
		return (
			service.findRenameLocations(file, offset, false, false, true) ?? []
		).flatMap((item) => {
			const target = lookup(item.fileName);
			return target
				? [
						{
							uri: target.uri,
							from: item.textSpan.start,
							to: item.textSpan.start + item.textSpan.length,
							text:
								(item.prefixText ?? "") +
								(request.name ?? "") +
								(item.suffixText ?? ""),
							version: target.version,
						},
					]
				: [];
		});
	}
	if (request.method === "format") {
		if (!supported) {
			if (document.language === "json")
				return [
					{
						uri: document.uri,
						from: 0,
						to: document.text.length,
						text: JSON.stringify(
							JSON.parse(document.text),
							null,
							settings.convertTabsToSpaces
								? settings.tabSize
								: "\t",
						),
					},
				];
			return [];
		}
		const result = request.range
			? service.getFormattingEditsForRange(
					file,
					request.range.from,
					request.range.to,
					settings,
				)
			: service.getFormattingEditsForDocument(file, settings);
		return result.map((edit) => ({
			uri: document.uri,
			from: edit.span.start,
			to: edit.span.start + edit.span.length,
			text: edit.newText,
			version: document.version,
		}));
	}
	if (request.method === "actions") {
		if (!supported) return [];
		const diagnostics = [
			...service.getSyntacticDiagnostics(file),
			...service.getSemanticDiagnostics(file),
		].filter(
			(d) =>
				d.start !== undefined &&
				offset >= (d.start ?? 0) &&
				offset <= (d.start ?? 0) + (d.length ?? 1),
		);
		const result: CodeAction[] = [];
		for (const diagnostic of diagnostics)
			for (const fix of service.getCodeFixesAtPosition(
				file,
				diagnostic.start ?? offset,
				(diagnostic.start ?? offset) + (diagnostic.length ?? 0),
				[diagnostic.code],
				settings,
				{},
			))
				if (canApplyChanges(fix.changes) && !fix.commands?.length)
					result.push({
						title: fix.description,
						edits: edits(fix.changes),
					});
		result.push({
			title: "Organize imports",
			edits: edits(
				service.organizeImports(
					{ type: "file", fileName: file },
					settings,
					{},
				),
			),
		});
		return result.filter((action) => action.edits.length);
	}
	return null;
}
