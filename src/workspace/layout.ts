export interface EditorGroup {
	id: string;
	documentId?: string;
}

export class WorkspaceLayout {
	groups: EditorGroup[] = [{ id: "main" }];
	active = "main";
	orientation: "row" | "column" = "row";

	show(documentId: string): void {
		const visible = this.groups.find(
			(group) => group.documentId === documentId,
		);
		if (visible) {
			this.active = visible.id;
			return;
		}
		const group =
			this.groups.find((group) => group.id === this.active) ??
			this.groups[0];
		group.documentId = documentId;
		this.active = group.id;
	}
	split(documentId: string): void {
		if (this.groups.length >= 4)
			throw new Error("Up to four editor groups are supported.");
		const group = { id: crypto.randomUUID(), documentId };
		this.groups = [...this.groups, group];
		this.active = group.id;
	}
	close(id: string): void {
		if (this.groups.length === 1) return;
		this.groups = this.groups.filter((group) => group.id !== id);
		if (this.active === id) this.active = this.groups[0].id;
	}
	move(documentId: string, targetId: string): void {
		const source = this.groups.find(
			(group) => group.documentId === documentId,
		);
		const target = this.groups.find((group) => group.id === targetId);
		if (!target) return;
		if (source) source.documentId = target.documentId;
		target.documentId = documentId;
		this.active = target.id;
	}
	prune(ids: readonly string[]): void {
		for (const group of this.groups)
			if (group.documentId && !ids.includes(group.documentId))
				group.documentId = undefined;
	}
	serialize(): string {
		return JSON.stringify({
			version: 1,
			groups: this.groups,
			active: this.active,
			orientation: this.orientation,
		});
	}
	static restore(raw: string, ids: readonly string[]): WorkspaceLayout {
		const data = JSON.parse(raw);
		const layout = new WorkspaceLayout();
		if (
			data?.version !== 1 ||
			!Array.isArray(data.groups) ||
			!data.groups.length ||
			data.groups.length > 4
		)
			throw new Error("Invalid saved editor layout");
		const seen = new Set<string>();
		const documents = new Set<string>();
		layout.groups = data.groups.map((group: EditorGroup) => {
			if (typeof group.id !== "string" || seen.has(group.id))
				throw new Error("Invalid editor group");
			seen.add(group.id);
			const documentId =
				typeof group.documentId === "string" &&
				ids.includes(group.documentId) &&
				!documents.has(group.documentId)
					? group.documentId
					: undefined;
			if (documentId) documents.add(documentId);
			return { id: group.id, documentId };
		});
		layout.active = seen.has(data.active)
			? data.active
			: layout.groups[0].id;
		layout.orientation = data.orientation === "column" ? "column" : "row";
		return layout;
	}
}
