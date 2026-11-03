import type { Disposable } from "../api/types";
import { Uri } from "../api/uri";
import { Emitter } from "./events";
import { TextModel, type TextModelOptions } from "./text-model";

export class ModelRegistry implements Disposable {
	private readonly models = new Map<string, TextModel>();
	private readonly created = new Emitter<TextModel>();
	private readonly removed = new Emitter<TextModel>();
	private disposed = false;
	createModel(
		text = "",
		options: Omit<TextModelOptions, "registry" | "register"> = {},
	): TextModel {
		if (this.disposed) throw new Error("Model registry disposed.");
		return new TextModel(text, { ...options, registry: this });
	}
	getModel(uri: Uri | string): TextModel | null {
		return (
			this.models.get(
				(typeof uri === "string" ? Uri.parse(uri) : uri).toString(),
			) ?? null
		);
	}
	getModels(): readonly TextModel[] {
		return [...this.models.values()];
	}
	onDidCreateModel(listener: (model: TextModel) => void): Disposable {
		return this.created.on(listener);
	}
	onWillDisposeModel(listener: (model: TextModel) => void): Disposable {
		return this.removed.on(listener);
	}
	add(model: TextModel): void {
		if (this.disposed) throw new Error("Model registry disposed.");
		const key = model.uri.toString();
		if (this.models.has(key))
			throw new Error(`A model already exists for ${key}`);
		this.models.set(key, model);
		this.created.emit(model);
	}
	remove(model: TextModel): void {
		const key = model.uri.toString();
		if (this.models.get(key) !== model) return;
		this.models.delete(key);
		this.removed.emit(model);
	}
	dispose(): void {
		if (this.disposed) return;
		for (const model of this.models.values()) model.assertCanDispose();
		this.disposed = true;
		for (const model of [...this.models.values()]) model.dispose();
		this.models.clear();
		this.created.dispose();
		this.removed.dispose();
	}
}

export const defaultModelRegistry = new ModelRegistry();
