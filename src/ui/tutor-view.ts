import { ItemView, type WorkspaceLeaf } from "obsidian";
import { groupAttemptsByExam } from "../core/statistics";
import { collectPrepAttempts, type UpcomingExam } from "../core/exam-prep";
import {
	aggregateMistakes,
	aggregateTopics,
	describeMisses,
	isRepeated,
	recommendNext,
	studyPriorities,
	type ExamPriority,
	type MistakeEntry,
	type PriorityStatus,
	type Recommendation,
	type RecommendedAction,
} from "../core/insights";
import type ExaminerPlugin from "../main";
import { gradeBoundaries } from "../settings";
import { toAttemptSummary, type ExamResultRecord, type PracticeAttemptRecord } from "../storage/results";
import { renderExamBoard } from "./exam-board";
import { MistakeReviewModal } from "./mistake-review-modal";
import { startExam } from "./start-exam";
import { formatPercent, renderEmptyState, renderSectionNav, renderStudyTimerButton, section, textButton, updateStudyTimerButton } from "./shared";

export const VIEW_TYPE_TUTOR = "examiner-tutor";

const STATUS_LABELS: Record<PriorityStatus, string> = {
	"needs-attention": "Needs attention",
	"room-to-improve": "Room to improve",
	"performing-well": "Performing well",
	"not-enough-evidence": "Not enough evidence yet",
};

const ACTION_LABELS: Record<RecommendedAction, string> = {
	"review-mistakes": "Review mistakes",
	"retry-exam": "Retry exam",
	"open-exams": "Open exams",
	"new-exam": "New exam",
};

export class TutorView extends ItemView {
	private renderToken = 0;
	private showAllMistakes = false;
	private timerButton: HTMLButtonElement | null = null;
	private selectedUpcomingId: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TUTOR;
	}

	override getDisplayText(): string {
		return "Tutor";
	}

	override getIcon(): string {
		return "lightbulb";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-tutor");
		this.register(this.plugin.results.onChange(() => void this.render()));
		this.register(this.plugin.exams.onChange(() => void this.render()));
		this.register(this.plugin.questions.onChange(() => void this.render()));
		this.registerInterval(window.setInterval(() => this.updateTimerButton(), 1000));
		await this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = createDiv({ cls: "examiner-exams-body" });
		const header = root.createDiv({ cls: "examiner-page-header" });
		renderSectionNav(header, this.plugin, this.leaf, "tutor");
		const actions = header.createDiv({ cls: "examiner-header-actions" });
		this.timerButton = renderStudyTimerButton(actions, this.plugin);

		const now = new Date();
		let records: ExamResultRecord[];
		let practiceAttempts: PracticeAttemptRecord[];
		let upcomingExams: UpcomingExam[];
		try {
			records = await this.plugin.results.readExamResults();
			practiceAttempts = await this.plugin.results.readPracticeAttempts();
			upcomingExams = await this.plugin.results.readUpcomingExams();
		} catch (error) {
			console.error("Examiner: could not read exam results", error);
			renderEmptyState(root, "Your exam results could not be read. See the developer console for details.");
			if (token === this.renderToken) this.contentEl.replaceChildren(root);
			return;
		}
		if (token !== this.renderToken) return;

		const groups = groupAttemptsByExam(records.map(toAttemptSummary), (examId) => this.plugin.exams.get(examId)?.title);
		const mistakes = aggregateMistakes(records, now);
		const priorities = studyPriorities(groups, records, gradeBoundaries(this.plugin.settings).d, now);
		renderExamBoard(root, this.plugin, upcomingExams, collectPrepAttempts(records, practiceAttempts), records.map(toAttemptSummary), now, this.selectedUpcomingId, (examId) => {
			this.selectedUpcomingId = examId;
			void this.render();
		});
		this.renderFocus(root, recommendNext(priorities, mistakes, this.plugin.exams.definitions().length > 0), priorities, mistakes);
		if (mistakes.length > 0) this.renderMistakes(root, mistakes);
		this.contentEl.replaceChildren(root);
	}

	private updateTimerButton(): void {
		if (this.timerButton) updateStudyTimerButton(this.timerButton, this.plugin);
	}

	private renderFocus(root: HTMLElement, recommendation: Recommendation | null, priorities: readonly ExamPriority[], mistakes: readonly MistakeEntry[]): void {
		if (!recommendation && priorities.length === 0) return;
		const block = section(root, "Focus");
		if (recommendation) this.renderNextStep(block, recommendation);
		if (priorities.length > 0) this.renderPriorities(block, priorities, mistakes);
	}

	private renderPriorities(block: HTMLElement, priorities: readonly ExamPriority[], mistakes: readonly MistakeEntry[]): void {
		const topics = aggregateTopics(mistakes.filter((mistake) => isRepeated(mistake) && !mistake.correctSinceLastMiss)).slice(0, 5);
		if (topics.length > 0) {
			const line = block.createDiv({ cls: "examiner-topic-line" });
			line.createSpan({ cls: "examiner-muted examiner-small", text: "Topics missed in several attempts:" });
			for (const topic of topics) line.createSpan({ cls: "examiner-tag", text: topic.tag });
		}
		const list = block.createDiv({ cls: "examiner-priorities" });
		for (const priority of priorities.slice(0, 6)) this.renderPriority(list, priority);
	}

	private renderPriority(parent: HTMLElement, priority: ExamPriority): void {
		const item = parent.createDiv({ cls: "examiner-priority" });
		const head = item.createDiv({ cls: "examiner-priority-head" });
		head.createSpan({ cls: "examiner-row-title", text: priority.title || "Untitled exam" });
		item.createDiv({ cls: "examiner-status-label", text: STATUS_LABELS[priority.status] });

		item.createDiv({ cls: "examiner-row-meta", text: `Latest attempt: ${formatPercent(priority.latest.percent)}` });
		for (const reason of priority.reasons) item.createDiv({ cls: "examiner-row-meta", text: reason });

		const actionRow = item.createDiv({ cls: "examiner-priority-action" });
		const exam = this.plugin.exams.get(priority.examId);
		const unresolved = priority.mistakes.filter((mistake) => !mistake.correctSinceLastMiss);
		const buttons = actionRow.createDiv({ cls: "examiner-priority-buttons" });
		if (priority.action === "review-mistakes") {
			textButton(buttons, "Review mistakes").addEventListener("click", () => this.reviewMistakes(unresolved));
		}
		const retry = textButton(buttons, "Retry");

		retry.disabled = !exam;
		retry.setAttribute("aria-label", exam ? `Retry ${exam.title || "this exam"}` : "This exam has been deleted");
		retry.addEventListener("click", () => {
			if (exam) void startExam(this.plugin, exam);
		});
	}

	private renderNextStep(block: HTMLElement, recommendation: Recommendation): void {
		const next = block.createDiv({ cls: "examiner-next-step" });
		next.createDiv({ cls: "examiner-row-title", text: recommendation.heading });
		next.createDiv({ cls: "examiner-row-meta", text: recommendation.detail });
		const exam = recommendation.examId === null ? undefined : this.plugin.exams.get(recommendation.examId);
		const actions = recommendation.actions.filter((action) => action !== "retry-exam" || exam !== undefined);
		if (actions.length === 0) return;
		const row = next.createDiv({ cls: "examiner-header-actions" });
		actions.forEach((action, index) => {
			textButton(row, ACTION_LABELS[action], index === 0).addEventListener("click", () => {
				switch (action) {
					case "review-mistakes":
						this.reviewMistakes(recommendation.mistakes);
						break;
					case "retry-exam":
						if (exam) void startExam(this.plugin, exam);
						break;
					case "open-exams":
						void this.plugin.openExams();
						break;
					case "new-exam":
						void this.plugin.editExam();
						break;
				}
			});
		});
	}

	private reviewMistakes(mistakes: readonly MistakeEntry[]): void {

		if (mistakes.length > 0) new MistakeReviewModal(this.plugin, mistakes, 0).open();
	}

	private renderMistakes(root: HTMLElement, mistakes: readonly MistakeEntry[]): void {

		const count = mistakes.length;
		const block = section(root, "Mistakes to revisit");
		const topics = aggregateTopics(mistakes).slice(0, 6);
		if (topics.length > 0) {
			const line = block.createDiv({ cls: "examiner-topic-line" });
			line.createSpan({ cls: "examiner-muted examiner-small", text: "By topic:" });
			for (const topic of topics) {
				line.createSpan({
					cls: "examiner-tag",
					text: `${topic.tag} (${topic.misses})`,
					attr: { title: `${topic.questions === 1 ? "1 question" : `${topic.questions} questions`}, ${topic.misses === 1 ? "1 miss" : `${topic.misses} misses`}` },
				});
			}
		}
		const limit = 8;
		const shown = this.showAllMistakes ? mistakes : mistakes.slice(0, limit);
		const list = block.createDiv({ cls: "examiner-list" });
		shown.forEach((mistake, index) => {
			const row = list.createEl("button", { cls: "examiner-attempt-row examiner-mistake-row" });
			const main = row.createDiv({ cls: "examiner-row-main" });
			main.createDiv({ cls: "examiner-mistake-title", text: `${mistake.examTitle || "Untitled exam"} ${mistake.title || "Untitled question"}` });
			main.createDiv({ cls: "examiner-row-meta", text: describeMisses(mistake) });
			if (isRepeated(mistake)) row.createSpan({ cls: "examiner-status-label", text: "Repeated" });
			row.addEventListener("click", () => new MistakeReviewModal(this.plugin, mistakes, index).open());
		});
		if (count > limit) {
			const toggle = textButton(block, this.showAllMistakes ? "Show fewer" : `Show all ${count}`);
			toggle.addClass("examiner-show-more");
			toggle.addEventListener("click", () => {
				this.showAllMistakes = !this.showAllMistakes;
				void this.render();
			});
		}
	}
}
