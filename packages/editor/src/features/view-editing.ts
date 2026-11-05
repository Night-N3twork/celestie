import type { EditorOptions } from "../api/editor-options";
import type { TextSelection } from "../api/types";
import {
	type LanguageConfiguration,
	wordExpression,
} from "../languages/configuration";
import type { BracketAnalysis } from "./bracket-analysis";
import { planBlockComment, planLineComment } from "./comments";
import {
	expansionRanges,
	planTextCommand,
	planWordCommand,
	type TextCommand,
} from "./editing-commands";
import type { EditingPlan } from "./editing-plan";
import { type LineCommand, planLineCommand } from "./line-commands";
import {
	combineLinePlans,
	combinePlans,
	type MultiEditingPlan,
} from "./selections";

interface Host {
	text(): string;
	options(): EditorOptions;
	language(): LanguageConfiguration;
	disposed(): boolean;
	composing(): boolean;
	isComposing(): boolean;
	getSelection(): TextSelection;
	getSelections(): readonly TextSelection[];
	setSelections(values: readonly TextSelection[], reveal?: boolean): void;
	getAnalysis(): BracketAnalysis;
	sameSelection(a: TextSelection, b: TextSelection): boolean;
	breakHistoryGroup(): void;
	applyEditingPlan(plan: EditingPlan | undefined): void;
	applyMultiPlan(plan: MultiEditingPlan, inputKind?: string): void;
	announce(message: string): void;
}
export class ViewEditing {
	private readonly selectionHistory: TextSelection[] = [];
	private multiExpansion: TextSelection[][] = [];
	private multiExpandedKey = "";
	private expandedSelection: TextSelection | undefined;
	constructor(private readonly host: Host) {}
	runTextCommand(command: TextCommand): void {
		if (
			[
				"joinLines",
				"sortAscending",
				"sortDescending",
				"uniqueLines",
				"reverseLines",
			].includes(command)
		) {
			this.applyPerLine((selection) =>
				planTextCommand(
					this.host.text(),
					selection,
					command,
					wordExpression(this.host.language()),
				),
			);
			return;
		}
		this.applyPerSelection((selection) =>
			planTextCommand(
				this.host.text(),
				selection,
				command,
				wordExpression(this.host.language()),
			),
		);
	}
	moveWord(
		direction: -1 | 1,
		action: "move" | "select" | "delete",
		subword = false,
	): void {
		this.applyPerSelection((selection) =>
			planWordCommand(
				this.host.text(),
				selection,
				direction,
				action,
				subword,
				wordExpression(this.host.language()),
			),
		);
	}
	jumpToBracket(select = false): void {
		this.applyPerSelection((selection) => {
			const active =
				selection.direction === "backward"
					? selection.start
					: selection.end;
			const [candidate, partner] = this.host
				.getAnalysis()
				.matchingAt(active);
			if (candidate === undefined || partner === undefined) {
				this.host.announce("No matching bracket at the cursor.");
				return;
			}
			const target = partner + (partner > candidate ? 1 : 0);
			const anchor = select
				? selection.direction === "backward"
					? selection.end
					: selection.start
				: target;
			return {
				edits: [],
				selection: {
					start: Math.min(anchor, target),
					end: Math.max(anchor, target),
					direction: target < anchor ? "backward" : "forward",
				},
			};
		});
	}
	expandSelection(shrink = false): void {
		if (this.multiExpandedKey !== JSON.stringify(this.host.getSelections()))
			this.multiExpansion.length = 0;
		if (
			this.host.getSelections().length > 1 ||
			(shrink && this.multiExpansion.length > 0)
		) {
			if (shrink) {
				const previous = this.multiExpansion.pop();
				if (previous) this.host.setSelections(previous, true);
			} else {
				this.multiExpansion.push(
					this.host.getSelections().map((value) => ({ ...value })),
				);
				if (this.multiExpansion.length > 100)
					this.multiExpansion.shift();
				this.applyPerSelection((selection) => {
					const next = expansionRanges(
						this.host.text(),
						selection,
						this.host.getAnalysis(),
						wordExpression(this.host.language()),
					)[0];
					return next ? { edits: [], selection: next } : undefined;
				});
			}
			this.multiExpandedKey = JSON.stringify(this.host.getSelections());
			return;
		}
		const selection = this.host.getSelection();
		if (
			!this.expandedSelection ||
			!this.host.sameSelection(this.expandedSelection, selection)
		)
			this.selectionHistory.length = 0;
		const next = shrink
			? this.selectionHistory.pop()
			: expansionRanges(
					this.host.text(),
					selection,
					this.host.getAnalysis(),
					wordExpression(this.host.language()),
				)[0];
		if (!next) return;
		if (!shrink) this.selectionHistory.push(selection);
		this.host.applyEditingPlan({ edits: [], selection: next });
		this.expandedSelection = this.host.getSelection();
	}
	runLineCommand(command: LineCommand): void {
		if (this.host.disposed()) throw new Error("Editor view disposed.");
		if (this.host.composing()) return;
		this.host.breakHistoryGroup();
		if (command === "insertAbove" || command === "insertBelow") {
			this.applyPerSelection((selection) =>
				planLineCommand(
					this.host.text(),
					selection,
					command,
					this.host.options(),
				),
			);
			return;
		}
		this.applyPerLine(
			(selection, includeEndLine) =>
				planLineCommand(
					this.host.text(),
					selection,
					command,
					this.host.options(),
					includeEndLine,
				),
			command.startsWith("move") || command.startsWith("duplicate")
				? "shift"
				: "collapse",
		);
	}
	toggleLineComment(mode?: "add" | "remove"): void {
		if (this.host.composing()) return;
		this.applyPerLine((selection) =>
			planLineComment(
				this.host.text(),
				selection,
				this.host.language(),
				mode,
			),
		);
	}
	toggleBlockComment(): void {
		if (this.host.composing()) return;
		this.applyPerSelection((selection) =>
			planBlockComment(this.host.text(), selection, this.host.language()),
		);
	}
	private applyPerLine(
		planner: (
			selection: TextSelection,
			includeEndLine: boolean,
		) => EditingPlan | undefined,
		transform: "map" | "shift" | "collapse" = "map",
	): void {
		if (this.host.isComposing()) return;
		try {
			this.host.applyMultiPlan(
				combineLinePlans(
					this.host.text(),
					this.host.getSelections(),
					planner,
					transform,
				),
			);
		} catch (error) {
			this.host.announce(
				error instanceof Error
					? error.message
					: "Cannot combine these line edits.",
			);
		}
	}
	applyPerSelection(
		planner: (selection: TextSelection) => EditingPlan | undefined,
		inputKind?: string,
	): void {
		const plans = this.host
			.getSelections()
			.map((selection) => planner(selection) ?? { edits: [], selection });
		try {
			this.host.applyMultiPlan(
				combinePlans(plans, this.host.text().length),
				inputKind,
			);
		} catch (error) {
			this.host.announce(
				error instanceof Error
					? error.message
					: "Cannot combine these edits.",
			);
		}
	}
	resetSingle(): void {
		this.selectionHistory.length = 0;
		this.expandedSelection = undefined;
	}
	resetMulti(): void {
		this.multiExpansion.length = 0;
		this.multiExpandedKey = "";
	}
}
