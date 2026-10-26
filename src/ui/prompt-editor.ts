import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, showTooltip, WidgetType, type DecorationSet, type Tooltip } from "@codemirror/view";
import { finishRenderMath, renderMath } from "obsidian";
import { findMathRanges, findTemplateReferences, type MathRange } from "../core/template";

export function createPromptEditor(parent: HTMLElement, initial: string, onChange: (text: string) => void): EditorView {
	return new EditorView({
		parent,
		state: EditorState.create({
			doc: initial,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				EditorView.lineWrapping,
				placeholder("What is {x} + {y}?"),
				EditorView.contentAttributes.of({ "aria-label": "Question", spellcheck: "true" }),
				promptDecorations,
				mathTooltip,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChange(update.state.doc.toString());
				}),
			],
		}),
	});
}

function renderMathInto(element: HTMLElement, range: MathRange): void {
	element.empty();
	if (range.source.trim() === "") return;
	element.appendChild(renderMath(range.source, range.display));
	void finishRenderMath();
}

class MathWidget extends WidgetType {
	constructor(private readonly range: MathRange) {
		super();
	}

	override eq(other: MathWidget): boolean {
		return other.range.source === this.range.source && other.range.display === this.range.display;
	}

	override toDOM(): HTMLElement {
		const element = createSpan({ cls: this.range.display ? "examiner-math examiner-math-display" : "examiner-math" });
		renderMathInto(element, this.range);
		return element;
	}

	override ignoreEvent(): boolean {
		return false;
	}
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function buildDecorations(state: EditorState): DecorationSet {
	const text = state.doc.toString();
	const decorations: Range<Decoration>[] = [];
	const math = findMathRanges(text);
	for (const range of math) {
		if (range.source.trim() !== "" && !selectionTouches(state, range.from, range.to)) {
			decorations.push(Decoration.replace({ widget: new MathWidget(range) }).range(range.from, range.to));
		}
	}
	for (const reference of findTemplateReferences(text)) {
		if (reference.inMath) continue;
		decorations.push(Decoration.mark({ class: "examiner-variable-token" }).range(reference.start, reference.end));
	}
	return Decoration.set(decorations, true);
}

const promptDecorations = StateField.define<DecorationSet>({
	create: buildDecorations,
	update: (value, transaction) => (transaction.docChanged || transaction.selection ? buildDecorations(transaction.state) : value),
	provide: (field) => EditorView.decorations.from(field),
});

function editedMathTooltip(state: EditorState): Tooltip | null {
	const head = state.selection.main.head;
	const range = findMathRanges(state.doc.toString()).find((math) => head >= math.from && head <= math.to);
	if (!range || range.source.trim() === "") return null;
	return {
		pos: range.from,
		above: false,
		create: () => {
			const dom = createDiv({ cls: "examiner-math-tooltip" });
			renderMathInto(dom, range);
			return { dom };
		},
	};
}

const mathTooltip = StateField.define<Tooltip | null>({
	create: editedMathTooltip,
	update: (value, transaction) => (transaction.docChanged || transaction.selection ? editedMathTooltip(transaction.state) : value),
	provide: (field) => showTooltip.from(field),
});
