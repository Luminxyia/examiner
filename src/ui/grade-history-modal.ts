import { Modal } from "obsidian";
import { formatDuration, type NumberedAttempt } from "../core/statistics";
import type ExaminerPlugin from "../main";
import { GradeChart, gradePoints } from "./charts";
import { formatDateTime, formatPercent, formatScore } from "./shared";

export class GradeHistoryModal extends Modal {
	constructor(
		private readonly plugin: ExaminerPlugin,
		private readonly examTitle: string,
		private readonly history: readonly NumberedAttempt[],
		private readonly passingPercent: number | null,
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		this.modalEl.addClass("examiner-history-modal");
		this.setTitle(`Grade history: ${this.examTitle}`);
		const { contentEl } = this;

		if (this.history.length === 0) {
			contentEl.createDiv({ cls: "examiner-empty", text: "No completed attempts yet. Results appear here after you submit this exam." });
			return;
		}

		new GradeChart(contentEl).update(gradePoints(this.history), false, this.passingPercent);

		const scroller = contentEl.createDiv({ cls: "examiner-table-scroll examiner-history-table" });
		const table = scroller.createEl("table", { cls: "examiner-question-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const label of ["Attempt", "Date", "Marks", "Grade", "Active time"]) head.createEl("th", { text: label });
		const body = table.createEl("tbody");
		for (const attempt of [...this.history].reverse()) {
			const row = body.createEl("tr", { cls: "examiner-clickable-row", attr: { tabindex: "0", role: "link" } });
			row.setAttribute("aria-label", `Open attempt ${attempt.attemptNumber}, ${formatPercent(attempt.percent)}`);
			row.createEl("td", { text: String(attempt.attemptNumber) });
			row.createEl("td", { text: formatDateTime(attempt.submittedAt) });
			row.createEl("td", { text: formatScore(attempt.marks, attempt.maxMarks) });
			row.createEl("td", { text: formatPercent(attempt.percent) });
			row.createEl("td", { cls: "examiner-muted", text: attempt.activeMs === undefined ? "Not recorded" : formatDuration(attempt.activeMs) });
			const open = () => {
				this.close();
				void this.plugin.openAttempt(attempt.id);
			};
			row.addEventListener("click", open);
			row.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
