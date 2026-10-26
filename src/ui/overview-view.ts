import { DropdownComponent, ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import {
	attemptedExams,
	compareWithYesterday,
	examHistory,
	filterExamGroups,
	formatDuration,
	formatSignedPercent,
	groupAttemptsByExam,
	summariseStudy,
	type AttemptSummary,
	type ExamGroup,
	type HistoryFilter,
	type ScoreTrend,
	type StudyOverview,
} from "../core/statistics";
import { DEFAULT_PASSING_PERCENT, type ExamDefinition } from "../core/exam";
import {
	aggregateMistakes,
	aggregateTopics,
	describeMisses,
	isRepeated,
	recommendNext,
	selectTargetedQuestions,
	studyPriorities,
	type ExamPriority,
	type MistakeEntry,
	type PriorityStatus,
	type Recommendation,
	type RecommendedAction,
	type TargetCandidate,
} from "../core/insights";

import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { toAttemptSummary, type ExamResultRecord } from "../storage/results";
import { GradeChart, gradePoints, renderStudyHeatmap } from "./charts";
import { GradeHistoryModal } from "./grade-history-modal";
import { MistakeReviewModal } from "./mistake-review-modal";
import { startExam } from "./start-exam";
import { formatDateTime, formatPercent, formatRelativeTime, formatScore, renderEmptyState, section, textButton } from "./shared";

export const VIEW_TYPE_OVERVIEW = "examiner-overview";

const STATUS_LABELS: Record<PriorityStatus, string> = {
	"needs-attention": "Needs attention",
	"room-to-improve": "Room to improve",
	"performing-well": "Performing well",
	"not-enough-evidence": "Not enough evidence yet",
};

const ACTION_LABELS: Record<RecommendedAction, string> = {
	"review-mistakes": "Review mistakes",
	"retry-exam": "Retry exam",
	"create-exam": "Create exam",
	"open-exams": "Open exams",
	"new-exam": "New exam",
};

const HISTORY_FILTERS: Record<HistoryFilter, string> = {
	all: "All exams",
	lowest: "Lowest scores",
	recent: "Recently attempted",
};

export class OverviewView extends ItemView {
	private renderToken = 0;
	private chosenExamId: string | null = null;
	private chart: GradeChart | null = null;
	private gradePicker: DropdownComponent | null = null;
	private gradeBlock: HTMLElement | null = null;
	private gradeAttempts: readonly AttemptSummary[] = [];
	private historyFilter: HistoryFilter = "all";
	private readonly expandedExams = new Set<string>();
	private showAllMistakes = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_OVERVIEW;
	}

	override getDisplayText(): string {
		return "Study overview";
	}

	override getIcon(): string {
		return "trending-up";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-overview");
		this.register(this.plugin.results.onChange(() => void this.render()));
		this.register(this.plugin.exams.onChange(() => void this.render()));
		await this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = createDiv({ cls: "examiner-exams-body" });
		const header = root.createDiv({ cls: "examiner-page-header" });
		header.createEl("h2", { cls: "examiner-heading", text: "Study overview" });
		textButton(header, "Exam Overview").addEventListener("click", () => void this.plugin.openExams());

		const now = new Date();
		let overview: StudyOverview;
		let attempts: AttemptSummary[];
		let records: ExamResultRecord[];
		try {
			const [sessions, results] = await Promise.all([this.plugin.results.readStudySessions(), this.plugin.results.readExamResults()]);
			records = results;
			attempts = results.map(toAttemptSummary);
			overview = summariseStudy(sessions, attempts, now);
		} catch (error) {
			console.error("Examiner: could not read study statistics", error);
			renderEmptyState(root, "Your study history could not be read. See the developer console for details.");
			if (token === this.renderToken) this.contentEl.replaceChildren(root);
			return;
		}
		if (token !== this.renderToken) return;
		this.chart?.destroy();
		this.chart = null;

		if (overview.totalStudyMs === 0 && attempts.length === 0) {
			this.renderEmpty(root);
		} else {
			this.renderToday(root, overview);
			renderStudyHeatmap(section(root, "Focused study per day"), overview.daily, now);
			const groups = groupAttemptsByExam(attempts, (examId) => this.plugin.exams.get(examId)?.title);
			const mistakes = aggregateMistakes(records, now);
			const priorities = studyPriorities(groups, records, (examId) => this.passingPercent(examId), now);
			this.renderNextStep(root, recommendNext(priorities, mistakes, this.plugin.exams.definitions().length > 0));
			this.renderPriorities(root, priorities, mistakes);

			const columns = root.createDiv({ cls: "examiner-overview-columns" });
			this.renderHistory(columns, groups);
			this.renderGrades(columns, attempts);
			this.renderMistakes(root, mistakes);
		}
		this.contentEl.replaceChildren(root);
	}

	override async onClose(): Promise<void> {
		this.chart?.destroy();
		this.chart = null;
		await Promise.resolve();
	}

	private renderEmpty(root: HTMLElement): void {
		const empty = root.createDiv({ cls: "examiner-overview-empty" });
		empty.createEl("p", { text: "Nothing recorded yet." });
		empty.createEl("p", {
			cls: "examiner-muted",
			text: "Time spent practising questions and taking exams is added here as you study, along with the score of every exam you submit.",
		});
		const actions = empty.createDiv({ cls: "examiner-header-actions" });
		textButton(actions, "Practice a question", true).addEventListener("click", () => this.plugin.choosePracticeQuestion());
	}

	private renderToday(root: HTMLElement, overview: StudyOverview): void {
		const today = root.createDiv({ cls: "examiner-today" });
		const main = today.createDiv({ cls: "examiner-today-main" });
		main.createDiv({ cls: "examiner-stat-label", text: "Today" });
		const line = main.createDiv({ cls: "examiner-today-line" });
		line.createSpan({ cls: "examiner-today-value", text: formatDuration(overview.todayMs) });

		const comparison = compareWithYesterday(overview.todayMs, overview.yesterdayMs);
		const change = line.createSpan({ cls: "examiner-today-change" });
		if (comparison.kind === "up" || comparison.kind === "down") {
			change.addClass(comparison.kind === "up" ? "is-up" : "is-down");
			setIcon(change.createSpan({ cls: "examiner-today-change-icon" }), comparison.kind === "up" ? "arrow-up" : "arrow-down");
			change.createSpan({ text: `${comparison.kind === "up" ? "+" : "−"}${comparison.percent}% vs yesterday` });
		} else {
			change.setText(comparison.kind === "same" ? "Same as yesterday" : "No study yesterday");
		}

		const total = today.createDiv({ cls: "examiner-today-total" });
		total.createDiv({ cls: "examiner-stat-label", text: "All time" });
		total.createDiv({ cls: "examiner-today-total-value", text: formatDuration(overview.totalStudyMs) });
	}

	private renderGrades(root: HTMLElement, attempts: readonly AttemptSummary[]): void {
		this.gradePicker = null;
		this.gradeAttempts = attempts;
		const exams = attemptedExams(attempts);
		if (!exams.some((exam) => exam.examId === this.chosenExamId)) this.chosenExamId = null;
		const selected = this.chosenExamId ?? exams[0]?.examId;
		let picker: DropdownComponent | null = null;
		const block = section(root, "Grade", undefined, (heading) => {
			if (exams.length === 0) return;
			picker = new DropdownComponent(heading);
			picker.selectEl.addClass("examiner-grade-picker");
			picker.selectEl.setAttribute("aria-label", "Exam");
			for (const exam of exams) picker.addOption(exam.examId, this.examTitle(exam.examId, exam.title));
		});
		this.gradeBlock = block;
		if (!picker || selected === undefined) {
			block.createDiv({ cls: "examiner-muted examiner-small", text: "No exams submitted yet." });
			return;
		}
		const dropdown: DropdownComponent = picker;
		this.gradePicker = dropdown;
		this.chart = new GradeChart(block);
		dropdown.onChange((examId) => this.showGrades(examId, true));
		this.showGrades(selected, false);
	}

	private showGrades(examId: string, animate: boolean): void {
		const history = examHistory(this.gradeAttempts, examId);
		if (!this.chart || !this.gradePicker || history.length === 0) return;
		this.chosenExamId = examId;
		this.gradePicker.setValue(examId);
		this.chart.setTitle(this.examTitle(examId, history[history.length - 1]?.examTitle ?? ""));
		this.chart.update(gradePoints(history), animate, this.passingPercent(examId));
	}

	private examTitle(examId: string, recorded: string): string {
		return this.plugin.exams.get(examId)?.title || recorded || "Untitled exam";
	}

	private passingPercent(examId: string): number | null {
		return this.plugin.exams.get(examId)?.passingPercent ?? null;
	}

	private renderHistory(root: HTMLElement, groups: readonly ExamGroup[]): void {
		let list: HTMLElement | null = null;
		const block = section(root, "Exam history", undefined, (heading) => {
			if (groups.length < 2) return;
			const filter = new DropdownComponent(heading).addOptions(HISTORY_FILTERS).setValue(this.historyFilter);
			filter.selectEl.addClass("examiner-grade-picker");
			filter.selectEl.setAttribute("aria-label", "Sort exams");
			filter.onChange((value) => {
				this.historyFilter = value as HistoryFilter;
				if (list) this.renderGroups(list, groups);
			});
		});
		if (groups.length === 0) {
			block.createDiv({ cls: "examiner-muted examiner-small", text: "No exams submitted yet." });
			return;
		}
		list = block.createDiv({ cls: "examiner-list examiner-exam-groups" });
		this.renderGroups(list, groups);
	}

	private renderGroups(list: HTMLElement, groups: readonly ExamGroup[]): void {
		list.empty();
		for (const group of filterExamGroups(groups, this.historyFilter)) {
			const details = list.createEl("details", { cls: "examiner-exam-group" });
			details.open = this.expandedExams.has(group.examId);
			details.addEventListener("toggle", () => {
				if (details.open) this.expandedExams.add(group.examId);
				else this.expandedExams.delete(group.examId);
			});
			const summary = details.createEl("summary");
			const main = summary.createDiv({ cls: "examiner-row-main" });
			const title = main.createEl("button", {
				cls: "examiner-link-button examiner-row-title",
				text: group.title || "Untitled exam",
				attr: { "aria-label": `${group.title || "Untitled exam"}: open the performance breakdown` },
			});
			title.addEventListener("click", (event) => {
				event.preventDefault();
				this.openBreakdown(group);
			});
			const count = group.attempts.length;
			main.createDiv({
				cls: "examiner-row-meta",
				text: `${count === 1 ? "1 attempt" : `${count} attempts`} · ${formatRelativeTime(group.latest.submittedAt)}`,
				attr: { title: `Last attempt ${formatDateTime(group.latest.submittedAt)}` },
			});
			const score = summary.createDiv({ cls: "examiner-row-score" });
			score.createDiv({ cls: "examiner-row-score-value", text: formatPercent(group.latest.percent) });
			renderTrend(score, group.trend);

			const attempts = details.createDiv({ cls: "examiner-group-attempts" });
			for (const attempt of group.attempts) {
				const row = attempts.createEl("button", {
					cls: "examiner-attempt-row",
					attr: { "aria-label": `Attempt ${attempt.attemptNumber}, ${formatPercent(attempt.percent)}. Open details` },
				});
				row.createSpan({ cls: "examiner-row-main", text: `Attempt ${attempt.attemptNumber}` });
				row.createSpan({ cls: "examiner-row-meta", text: formatDateTime(attempt.submittedAt) });
				row.createSpan({ cls: "examiner-row-meta examiner-group-marks", text: formatScore(attempt.marks, attempt.maxMarks) });
				row.createSpan({ cls: "examiner-group-percent", text: formatPercent(attempt.percent) });
				row.addEventListener("click", () => void this.plugin.openAttempt(attempt.id));
			}
		}
	}

	private renderPriorities(root: HTMLElement, priorities: readonly ExamPriority[], mistakes: readonly MistakeEntry[]): void {
		const block = section(root, "Your study priorities");
		if (priorities.length === 0) {
			block.createDiv({ cls: "examiner-muted examiner-small", text: "Submit an exam to see where to focus." });
			return;
		}
		const topics = aggregateTopics(mistakes.filter((mistake) => isRepeated(mistake) && !mistake.correctSinceLastMiss)).slice(0, 5);
		if (topics.length > 0) {
			const line = block.createDiv({ cls: "examiner-topic-line" });
			line.createSpan({ cls: "examiner-muted examiner-small", text: "Topics missed in several attempts:" });
			for (const topic of topics) line.createSpan({ cls: "examiner-tag", text: topic.tag });
		}
		const list = block.createDiv({ cls: "examiner-priorities" });
		const candidates = this.targetCandidates();
		for (const priority of priorities.slice(0, 6)) this.renderPriority(list, priority, candidates);
	}

	private targetCandidates(): TargetCandidate[] {
		return this.plugin.usableQuestions().map((question) => ({ id: question.id, tags: question.tags, title: question.title }));
	}

	private renderPriority(parent: HTMLElement, priority: ExamPriority, candidates: readonly TargetCandidate[]): void {
		const item = parent.createDiv({ cls: "examiner-priority" });
		const head = item.createDiv({ cls: "examiner-priority-head" });
		head.createSpan({ cls: "examiner-row-title", text: priority.title || "Untitled exam" });
		head.createSpan({ cls: "examiner-status-label", text: STATUS_LABELS[priority.status] });

		const facts = [`Latest attempt: ${formatPercent(priority.latest.percent)}`];
		if (priority.previous && priority.trend.kind === "change") facts.push(`previous attempt: ${formatPercent(priority.previous.percent)}`);
		item.createDiv({ cls: "examiner-row-meta", text: facts.join(" · ") });
		if (priority.reasons.length > 0) item.createDiv({ cls: "examiner-row-meta", text: priority.reasons.join(" · ") });

		const actionRow = item.createDiv({ cls: "examiner-priority-action" });
		const exam = this.plugin.exams.get(priority.examId);
		const unresolved = priority.mistakes.filter((mistake) => !mistake.correctSinceLastMiss);
		const recommendation: Record<ExamPriority["action"], string> = {
			"review-mistakes": "Review your latest mistakes.",
			"practice-mistakes": "Retry the questions you answered incorrectly.",
			"gather-evidence": "Take it again to build up enough evidence.",
			"retry-exam": priority.status === "performing-well" ? "Retake it later to check the results hold." : "Retake the exam.",
		};
		actionRow.createSpan({ cls: "examiner-small examiner-priority-advice", text: recommendation[priority.action] });

		const buttons = actionRow.createDiv({ cls: "examiner-priority-buttons" });
		if (priority.action === "review-mistakes") {
			textButton(buttons, "Review mistakes").addEventListener("click", () => this.reviewMistakes(unresolved));
		}
		const pair = buttons.createDiv({ cls: "examiner-priority-pair" });
		const tailored = textButton(pair, "Create tailored exam");
		const canTailor = selectTargetedQuestions(priority.mistakes, candidates).questionIds.length > 0;
		tailored.disabled = !canTailor;
		tailored.setAttribute(
			"aria-label",
			canTailor ? `Create an exam from the questions you got wrong in ${priority.title || "this exam"}` : "No questions you got wrong in this exam are available",
		);
		tailored.addEventListener("click", () => void this.createTargetedExam(priority.mistakes, priority.title));
		const retry = textButton(pair, "Retry");

		retry.disabled = !exam;
		retry.setAttribute("aria-label", exam ? `Retry ${exam.title || "this exam"}` : "This exam has been deleted");
		retry.addEventListener("click", () => {
			if (exam) void startExam(this.plugin, exam);
		});
	}

	private renderNextStep(root: HTMLElement, recommendation: Recommendation | null): void {
		const block = section(root, "Continue studying");
		if (!recommendation) {
			block.createDiv({ cls: "examiner-muted examiner-small", text: "Nothing to recommend yet." });
			return;
		}
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
					case "create-exam":
						void this.createTargetedExam(recommendation.mistakes);
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

	private async createTargetedExam(mistakes: readonly MistakeEntry[], focus?: string): Promise<void> {
		const selection = selectTargetedQuestions(mistakes, this.targetCandidates());
		if (selection.questionIds.length === 0) {
			new Notice("None of the questions you got wrong are still available. Retake one of your exams instead.");
			return;
		}
		const date = new Date().toLocaleDateString(undefined, { dateStyle: "medium" });
		const draft: ExamDefinition = {
			id: createId("e"),
			title: focus ? `${focus}: targeted practice` : `Targeted practice (${date})`,
			tags: [],
			timeLimitMinutes: null,
			passingPercent: DEFAULT_PASSING_PERCENT,
			questions: selection.questionIds.map((questionId) => ({ questionId, count: 1 })),
		};
		const parts = [`${selection.fromMistakes === 1 ? "1 question" : `${selection.fromMistakes} questions`} you got wrong`];
		if (selection.fromTopics > 0) parts.push(`${selection.fromTopics} more on the same topics`);
		new Notice(`Added ${parts.join(" and ")}. Review the exam, then save it to practice.`);
		await this.plugin.editExamDraft(draft);
	}

	private renderMistakes(root: HTMLElement, mistakes: readonly MistakeEntry[]): void {

		const count = mistakes.length;
		const block = section(root, "Mistakes to revisit");
		if (count === 0) {
			block.createDiv({ cls: "examiner-muted examiner-small", text: "No incorrect answers recorded yet." });
			return;
		}
		const topics = aggregateTopics(mistakes).slice(0, 6);
		if (topics.length > 0) {
			const line = block.createDiv({ cls: "examiner-topic-line" });
			line.createSpan({ cls: "examiner-muted examiner-small", text: "By topic:" });
			for (const topic of topics) {
				line.createSpan({
					cls: "examiner-tag",
					text: `${topic.tag} · ${topic.misses}`,
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
			main.createDiv({ cls: "examiner-mistake-title", text: `${mistake.examTitle || "Untitled exam"} · ${mistake.title || "Untitled question"}` });
			const meta = [describeMisses(mistake), formatRelativeTime(mistake.lastMissedAt)];
			if (mistake.correctSinceLastMiss) meta.push("answered correctly since");
			main.createDiv({ cls: "examiner-row-meta", text: meta.join(" · ") });
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

	private openBreakdown(group: ExamGroup): void {
		this.showGrades(group.examId, true);
		this.gradeBlock?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		const history = [...group.attempts].reverse();

		new GradeHistoryModal(this.plugin, group.title || "Untitled exam", history, this.passingPercent(group.examId)).open();
	}
}

function renderTrend(parent: HTMLElement, trend: ScoreTrend): void {
	if (trend.kind === "none") {
		parent.createDiv({
			cls: "examiner-row-meta",
			text: trend.reason === "single-attempt" ? "No trend yet" : "Not comparable",
			attr: {
				title: trend.reason === "single-attempt" ? "Only one attempt so far" : "The exam's questions changed since the previous attempt",
			},
		});
		return;
	}
	const arrow = trend.points > 0 ? "↑" : "↓";
	const text =
		trend.points === 0 ? "No change" : trend.relative === null ? `${arrow} from 0%` : `${arrow} ${formatSignedPercent(trend.relative)}`;
	const title =
		trend.points === 0
			? "Same score as the previous attempt"
			: trend.relative === null
				? "Up from 0% in the previous attempt, so a percentage change can't be calculated"
				: `${Math.abs(trend.relative)}% ${trend.points > 0 ? "higher" : "lower"} than the previous attempt`;
	parent.createDiv({
		cls: `examiner-row-meta examiner-trend ${trend.points > 0 ? "is-up" : trend.points < 0 ? "is-down" : ""}`,
		text,
		attr: { title },

	});

}
