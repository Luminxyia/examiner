import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import type { QuestionDefinition } from "../core/definition";
import { renderTags } from "./shared";

export class QuestionPickerModal extends FuzzySuggestModal<QuestionDefinition> {
	constructor(
		app: App,
		private readonly questions: QuestionDefinition[],
		private readonly onChoose: (question: QuestionDefinition) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a question to practice");
	}

	override getItems(): QuestionDefinition[] {
		return this.questions;
	}

	override getItemText(question: QuestionDefinition): string {
		return [question.title, ...question.tags].join(" ");
	}

	override renderSuggestion(match: FuzzyMatch<QuestionDefinition>, el: HTMLElement): void {
		el.addClass("examiner-suggestion");
		el.createDiv({ text: match.item.title || "Untitled question" });
		renderTags(el, match.item.tags);
	}

	override onChooseItem(question: QuestionDefinition): void {
		this.onChoose(question);
	}
}
