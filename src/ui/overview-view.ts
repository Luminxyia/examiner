import { DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
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
import type ExaminerPlugin from "../main";
import { toAttemptSummary } from "../storage/results";
import { GradeChart, gradePoints, renderStudyHeatmap } from "./charts";
import {
	formatDateTime,
	formatPercent,
	formatScore,
	renderEmptyState,
	renderSectionNav,
	renderStudyTimerButton,
	section,
	textButton,
	updateStudyTimerButton,
} from "./shared";

export const VIEW_TYPE_OVERVIEW = "examiner-overview";

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
	private gradeAttempts: readonly AttemptSummary[] = [];
	private historyFilter: HistoryFilter = "all";
	private readonly expandedExams = new Set<string>();
	private timerButton: HTMLButtonElement | null = null;

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
		this.registerInterval(window.setInterval(() => this.updateTimerButton(), 1000));
		await this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = createDiv({ cls: "examiner-exams-body" });
		const header = root.createDiv({ cls: "examiner-page-header" });
		renderSectionNav(header, this.plugin, this.leaf, "overview");
		const actions = header.createDiv({ cls: "examiner-header-actions" });
		this.timerButton = renderStudyTimerButton(actions, this.plugin);

		const now = new Date();
		let overview: StudyOverview;
		let attempts: AttemptSummary[];
		try {
			const [sessions, results] = await Promise.all([this.plugin.results.readStudySessions(), this.plugin.results.readExamResults()]);
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
			if (overview.totalStudyMs > 0) renderStudyHeatmap(section(root, "Focused study per day"), overview.daily, now);
			const groups = groupAttemptsByExam(attempts, (examId) => this.plugin.exams.get(examId)?.title);
			if (attempts.length > 0) {
				const columns = root.createDiv({ cls: "examiner-overview-columns" });
				this.renderHistory(columns, groups);
				this.renderGrades(columns, attempts);
			}
		}
		this.contentEl.replaceChildren(root);
	}

	private updateTimerButton(): void {
		if (this.timerButton) updateStudyTimerButton(this.timerButton, this.plugin);
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
		if (!picker || selected === undefined) return;
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
		if (groups.length === 0) return;
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
			summary.addEventListener("click", () => this.showGrades(group.examId, true));
			const main = summary.createDiv({ cls: "examiner-row-main" });
			main.createDiv({ cls: "examiner-row-title", text: group.title || "Untitled exam" });
			const count = group.attempts.length;
			main.createDiv({
				cls: "examiner-row-meta",
				text: count === 1 ? "1 attempt" : `${count} attempts`,
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
}

function renderTrend(parent: HTMLElement, trend: ScoreTrend): void {
	if (trend.kind === "none") {
		parent.createDiv({
			cls: "examiner-row-meta",
			text: trend.reason === "single-attempt" ? "No trend yet" : "Not comparable",
		});
		return;
	}
	let text = "No change";
	if (trend.points !== 0) {
		text = trend.relative === null ? "from 0%" : formatSignedPercent(trend.relative);
	}
	parent.createDiv({
		cls: `examiner-row-meta examiner-trend ${trend.points > 0 ? "is-up" : trend.points < 0 ? "is-down" : ""}`,
		text,
	});

}
