import { ItemView, type WorkspaceLeaf } from "obsidian";
import { formatTimeLimit, pendingMarking, type ExamDefinition } from "../core/exam";
import { numberAttempts, type NumberedAttempt } from "../core/statistics";
import type ExaminerPlugin from "../main";
import { toAttemptSummary, type ExamSession } from "../storage/results";
import { GradeHistoryModal } from "./grade-history-modal";
import { startExam } from "./start-exam";
import { confirm, formatDateTime, formatPercent, iconAction, renderEmptyState, renderLoadState, renderTags, textButton } from "./shared";

export const VIEW_TYPE_EXAMS = "examiner-exams";

export class ExamsView extends ItemView {
	private renderToken = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_EXAMS;
	}

	override getDisplayText(): string {
		return "Exams";
	}

	override getIcon(): string {
		return "clipboard-check";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-exams");
		this.register(this.plugin.exams.onChange(() => void this.render()));
		this.register(this.plugin.questions.onChange(() => void this.render()));
		this.register(this.plugin.results.onChange(() => void this.render()));
		this.register(this.plugin.loadState.onChange(() => void this.render()));
		await this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const [session, results] = await Promise.all([this.plugin.results.loadSession(), this.plugin.results.readExamResults()]);
		if (token !== this.renderToken) return;

		const root = createDiv({ cls: "examiner-exams-body" });
		const header = root.createDiv({ cls: "examiner-page-header" });
		header.createEl("h2", { cls: "examiner-heading", text: "Exams" });
		const actions = header.createDiv({ cls: "examiner-header-actions" });
		textButton(actions, "Study overview").addEventListener("click", () => void this.plugin.openOverview());
		const create = textButton(actions, "New exam", true);
		create.addEventListener("click", () => void this.plugin.editExam());

		if (!this.plugin.ready) {
			renderLoadState(root.createDiv({ cls: "examiner-empty" }), this.plugin, "Loading exams…");

			this.contentEl.replaceChildren(root);
			return;
		}

		if (session) this.renderSessionBanner(root, session);
		this.renderProblems(root);

		const exams = this.plugin.exams.definitions();
		if (exams.length === 0) {
			renderEmptyState(root, "No exams yet. Create one from your practice questions.");
		}
		const attempts = numberAttempts(results.map(toAttemptSummary));
		const list = root.createDiv({ cls: "examiner-list" });
		for (const exam of exams) this.renderExam(list, exam, attempts.filter((attempt) => attempt.examId === exam.id));
		this.contentEl.replaceChildren(root);
	}

	private renderSessionBanner(parent: HTMLElement, session: ExamSession): void {
		const banner = parent.createDiv({ cls: "examiner-banner" });
		const text = banner.createDiv({ cls: "examiner-row-main" });
		const marking = session.marking;
		text.createDiv({ cls: "examiner-row-title", text: `${marking ? "Marking" : "In progress"}: ${session.examTitle}` });
		const answered = session.responses.filter((response, index) => response.trim() !== "" || session.dontKnow?.[index]).length;
		const details = [`${answered} of ${session.items.length} answered`];
		if (marking) {
			const remaining = pendingMarking(session.items, session.responses, session.dontKnow).filter((index) => !marking.judgements[index]).length;
			details.push(remaining === 0 ? "ready to finish" : `${remaining} left to mark`);
		} else if (session.deadline !== null) {
			const minutes = Math.max(0, Math.ceil((session.deadline - Date.now()) / 60_000));
			details.push(minutes > 0 ? `about ${minutes} min left` : "time is up");
		}
		text.createDiv({ cls: "examiner-row-meta", text: details.join(", ") });
		const resume = textButton(banner, "Resume", true);
		resume.addEventListener("click", () => void this.plugin.openExamSession());
		const abandon = textButton(banner, "Abandon");
		abandon.addEventListener("click", () => void this.abandon(session));
	}

	private renderProblems(parent: HTMLElement): void {
		const problems = this.plugin.exams.problems();
		if (problems.length === 0) return;
		const details = parent.createEl("details", { cls: "examiner-problems" });
		details.createEl("summary", {
			text: problems.length === 1 ? "1 exam file needs attention" : `${problems.length} exam files need attention`,
		});
		for (const problem of problems) {
			const row = details.createDiv({ cls: "examiner-problem" });
			row.createEl("code", { text: problem.path });
			for (const error of problem.errors) row.createDiv({ cls: "examiner-error-text", text: error });
		}
	}

	private renderExam(parent: HTMLElement, exam: ExamDefinition, history: NumberedAttempt[]): void {
		const latest = history[history.length - 1];
		const row = parent.createDiv({ cls: "examiner-list-row" });
		const main = row.createDiv({ cls: "examiner-row-main" });
		main.createDiv({ cls: "examiner-row-title", text: exam.title || "Untitled exam" });
		const questionCount = exam.questions.reduce((sum, ref) => sum + ref.count, 0);
		const maxMarks = exam.questions.reduce((sum, ref) => sum + ref.count * (this.plugin.questions.get(ref.questionId)?.marks ?? 0), 0);
		const meta = [questionCount === 1 ? "1 question" : `${questionCount} questions`, maxMarks === 1 ? "1 mark" : `${maxMarks} marks`];
		meta.push(exam.timeLimitMinutes === null ? "untimed" : formatTimeLimit(exam.timeLimitMinutes));
		meta.push(
			latest
				? `${history.length === 1 ? "1 attempt" : `${history.length} attempts`}, last ${formatDateTime(latest.submittedAt)}`
				: "not taken yet",
		);
		main.createDiv({ cls: "examiner-row-meta", text: meta.join(", ") });
		renderTags(main, exam.tags);

		const result = row.createDiv({ cls: "examiner-row-result" });
		const graph = iconAction(result, "trending-up", history.length === 0 ? "No attempts yet" : "Grade history");
		graph.disabled = history.length === 0;
		graph.addEventListener("click", () => new GradeHistoryModal(this.plugin, exam.title || "Untitled exam", history, exam.passingPercent).open());
		if (latest) {
			const score = result.createEl("button", {
				cls: "examiner-row-score",
				attr: { "aria-label": `Last result, attempt ${latest.attemptNumber}: ${formatPercent(latest.percent)}. Open details` },
			});
			score.createDiv({ cls: "examiner-row-score-value", text: formatPercent(latest.percent) });
			score.addEventListener("click", () => void this.plugin.openAttempt(latest.id));
		}

		const actions = row.createDiv({ cls: "examiner-row-actions" });
		const start = textButton(actions, "Start", true);
		start.addEventListener("click", () => void startExam(this.plugin, exam));
		const edit = textButton(actions, "Edit");
		edit.addEventListener("click", () => void this.plugin.editExam(exam));
		const remove = iconAction(actions, "trash-2", "Delete exam");
		remove.addEventListener("click", () => void this.delete(exam));
	}

	private async abandon(session: ExamSession): Promise<void> {
		const confirmed = await confirm(this.app, {
			title: "Abandon this exam?",
			message: `Your answers to "${session.examTitle}" will be discarded and no result will be recorded.`,
			confirmText: "Abandon",
			destructive: true,
		});
		if (!confirmed) return;
		await this.plugin.results.clearSession();
	}

	private async delete(exam: ExamDefinition): Promise<void> {
		const confirmed = await confirm(this.app, {
			title: `Delete "${exam.title || "Untitled exam"}"?`,
			message: "Its file will be moved to the trash. Past results are kept, and the questions are not affected.",
			confirmText: "Delete",
			destructive: true,
		});
		if (!confirmed) return;
		await this.plugin.exams.delete(exam.id);
		await this.plugin.attachments.removeOwner(exam.id).catch((error: unknown) => {
			console.error("Examiner: could not delete the exam's reference materials", error);
		});
	}
}
