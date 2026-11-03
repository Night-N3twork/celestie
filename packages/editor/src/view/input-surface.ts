import type { Disposable, TextSelection } from "../api/types";
import { findTextChange } from "./input";

export const inputContextLimit = 8192;
const contextRadius = 2048;

export interface InputWindow {
	readonly text: string;
	readonly start: number;
	readonly gapAt: number;
	readonly gapLength: number;
	readonly selectionStart: number;
	readonly selectionEnd: number;
}

export function createInputWindow(
	text: string,
	selection: TextSelection,
): InputWindow {
	let start = Math.max(0, selection.start - contextRadius);
	let end = Math.min(text.length, selection.end + contextRadius);
	if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? "")) start--;
	if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end] ?? "")) end++;
	const selected = selection.end - selection.start;
	const gapLength =
		end - start > inputContextLimit ? Math.max(0, selected - 1) : 0;
	const gapAt = selection.start - start;
	const value = gapLength
		? text.slice(start, selection.start) +
			"\uFFFC" +
			text.slice(selection.end, end)
		: text.slice(start, end);
	return {
		text: value,
		start,
		gapAt,
		gapLength,
		selectionStart: selection.start - start,
		selectionEnd: selection.end - start - gapLength,
	};
}

export function windowOffset(window: InputWindow, offset: number): number {
	return (
		window.start +
		offset +
		(window.gapLength && offset > window.gapAt ? window.gapLength : 0)
	);
}

export class InputSurface implements Disposable {
	private source = "";
	private start = 0;
	private end = 0;
	private direction: TextSelection["direction"] = "none";
	private window: InputWindow = createInputWindow("", {
		start: 0,
		end: 0,
		direction: "none",
	});
	private viewportValue: HTMLElement | undefined;
	private composing = false;
	private accessible = false;
	private syncing = false;
	private disposed = false;
	private nativeBeforeSelection = { start: 0, end: 0 };
	constructor(readonly native: HTMLTextAreaElement) {
		native.addEventListener("beforeinput", this.captureNativeSelection);
		native.addEventListener("input", this.readInput);
		for (const event of ["select", "selectionchange", "keyup"])
			native.addEventListener(event, this.readSelection);
		native.addEventListener("compositionstart", this.compositionStart);
		native.addEventListener("compositionend", this.compositionEnd);
	}
	attachViewport(viewport: HTMLElement): void {
		this.viewportValue = viewport;
	}
	setAccessible(value: boolean): void {
		this.accessible = value;
		this.sync();
	}
	get value(): string {
		return this.source;
	}
	set value(value: string) {
		this.source = value;
		this.start = Math.min(this.start, value.length);
		this.end = Math.min(this.end, value.length);
		this.sync();
	}
	get selectionStart(): number {
		return this.start;
	}
	get selectionEnd(): number {
		return this.end;
	}
	get selectionDirection(): TextSelection["direction"] {
		return this.direction;
	}
	setSelectionRange(
		start: number,
		end: number,
		direction: TextSelection["direction"] = "none",
	): void {
		this.start = Math.max(0, Math.min(this.source.length, start));
		this.end = Math.max(this.start, Math.min(this.source.length, end));
		this.direction = this.start === this.end ? "none" : direction;
		this.sync();
	}
	setRangeText(
		value: string,
		start: number,
		end: number,
		_mode: "end",
	): void {
		this.source =
			this.source.slice(0, start) + value + this.source.slice(end);
		this.setSelectionRange(start + value.length, start + value.length);
	}
	private sync(): void {
		if (this.composing || this.disposed) return;
		this.syncing = true;
		const selection = {
			start: this.start,
			end: this.end,
			direction: this.direction,
		};
		this.window = this.accessible
			? {
					text: this.source,
					start: 0,
					gapAt: 0,
					gapLength: 0,
					selectionStart: this.start,
					selectionEnd: this.end,
				}
			: createInputWindow(this.source, selection);
		if (this.native.value !== this.window.text)
			this.native.value = this.window.text;
		if (
			this.native.selectionStart !== this.window.selectionStart ||
			this.native.selectionEnd !== this.window.selectionEnd ||
			(this.start !== this.end &&
				this.native.selectionDirection !== this.direction)
		)
			this.native.setSelectionRange(
				this.window.selectionStart,
				this.window.selectionEnd,
				this.direction,
			);
		this.syncing = false;
	}
	private readonly readSelection = (): void => {
		if (this.syncing || this.disposed) return;
		this.start = windowOffset(this.window, this.native.selectionStart);
		this.end = windowOffset(this.window, this.native.selectionEnd);
		this.direction =
			this.start === this.end ? "none" : this.native.selectionDirection;
	};
	private readonly captureNativeSelection = (): void => {
		this.nativeBeforeSelection = {
			start: this.native.selectionStart,
			end: this.native.selectionEnd,
		};
	};
	private readonly readInput = (event: Event): void => {
		if (this.disposed) return;
		const value = this.native.value,
			previous = this.window;
		let change = findTextChange(previous.text, value);
		const input = event as InputEvent;
		if (
			!change &&
			previous.gapLength > 0 &&
			input.data === "\uFFFC" &&
			input.inputType?.startsWith("insert") &&
			this.nativeBeforeSelection.start <= previous.gapAt &&
			this.nativeBeforeSelection.end > previous.gapAt
		) {
			change = {
				from: previous.gapAt,
				to: previous.gapAt + 1,
				text: "\uFFFC",
			};
		}
		if (change) {
			const from = windowOffset(previous, change.from),
				to = windowOffset(previous, change.to);
			this.source =
				this.source.slice(0, from) +
				change.text +
				this.source.slice(to);
			const replacesGap =
				previous.gapLength > 0 &&
				change.from <= previous.gapAt &&
				change.to > previous.gapAt;
			const gapAt =
				change.to <= previous.gapAt
					? previous.gapAt +
						change.text.length -
						(change.to - change.from)
					: previous.gapAt;
			this.window = {
				...previous,
				text: value,
				gapAt,
				gapLength: replacesGap ? 0 : previous.gapLength,
				selectionStart: this.native.selectionStart,
				selectionEnd: this.native.selectionEnd,
			};
		}
		this.readSelection();
	};
	private readonly compositionStart = (): void => {
		this.composing = true;
	};
	private readonly compositionEnd = (): void => {
		this.composing = false;
		queueMicrotask(() => this.sync());
	};
	get viewport(): HTMLElement {
		return this.viewportValue ?? this.native;
	}
	get ownerDocument(): Document {
		return this.native.ownerDocument;
	}
	get scrollTop(): number {
		return this.viewport.scrollTop;
	}
	set scrollTop(value: number) {
		this.viewport.scrollTop = value;
	}
	get scrollLeft(): number {
		return this.viewport.scrollLeft;
	}
	set scrollLeft(value: number) {
		this.viewport.scrollLeft = value;
	}
	get clientHeight(): number {
		return this.viewport.clientHeight;
	}
	get clientWidth(): number {
		return this.viewport.clientWidth;
	}
	getBoundingClientRect(): DOMRect {
		return this.viewport.getBoundingClientRect();
	}
	get readOnly(): boolean {
		return this.native.readOnly;
	}
	set readOnly(value: boolean) {
		this.native.readOnly = value;
	}
	get className(): string {
		return this.native.className;
	}
	set className(value: string) {
		this.native.className = value;
	}
	set title(value: string) {
		this.native.title = value;
	}
	set spellcheck(value: boolean) {
		this.native.spellcheck = value;
	}
	set autocomplete(value: AutoFill) {
		this.native.autocomplete = value;
	}
	set wrap(value: string) {
		this.native.wrap = value;
	}
	setAttribute(name: string, value: string): void {
		this.native.setAttribute(name, value);
	}
	focus(options?: FocusOptions): void {
		this.native.focus(options);
	}
	addEventListener<K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void {
		this.native.addEventListener(type, listener);
	}
	removeEventListener<K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void {
		this.native.removeEventListener(type, listener);
	}
	dispose(): void {
		this.disposed = true;
		this.source = "";
		this.native.removeEventListener(
			"beforeinput",
			this.captureNativeSelection,
		);
		this.native.removeEventListener("input", this.readInput);
		for (const event of ["select", "selectionchange", "keyup"])
			this.native.removeEventListener(event, this.readSelection);
		this.native.removeEventListener(
			"compositionstart",
			this.compositionStart,
		);
		this.native.removeEventListener("compositionend", this.compositionEnd);
	}
}
