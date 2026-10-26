import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import { formatTimeLimit, type ExamDefinition } from "../core/exam";

export class ExamPickerModal extends FuzzySuggestModal<ExamDefinition> {
	constructor(
		app: App,
		private readonly exams: ExamDefinition[],
		private readonly onChoose: (exam: ExamDefinition) => void,
	) {
		super(app);
		this.setPlaceholder("Choose an exam to edit");
	}

	override getItems(): ExamDefinition[] {
		return this.exams;
	}

	override getItemText(exam: ExamDefinition): string {
		return exam.title || "Untitled exam";
	}

	override renderSuggestion(match: FuzzyMatch<ExamDefinition>, el: HTMLElement): void {
		el.addClass("examiner-suggestion");
		el.createDiv({ text: match.item.title || "Untitled exam" });
		const count = match.item.questions.reduce((sum, ref) => sum + ref.count, 0);
		const time = match.item.timeLimitMinutes === null ? "untimed" : formatTimeLimit(match.item.timeLimitMinutes);
		el.createDiv({ cls: "examiner-row-meta", text: `${count === 1 ? "1 question" : `${count} questions`}, ${time}` });
	}

	override onChooseItem(exam: ExamDefinition): void {
		this.onChoose(exam);
	}
}
