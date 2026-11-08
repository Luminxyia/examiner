import { setTooltip } from "obsidian";
import { buildExamBoard, remainingUpcomingExams, scopeQuestionIds, type BoardTile, type ExamBoard, type PrepAttempt, type TileState, type UpcomingExam } from "../core/exam-prep";
import { predictExam, predictionChangeToday, type ExamPrediction, type PredictionQuestion } from "../core/prediction";
import { formatSignedPercent, type AttemptSummary } from "../core/statistics";
import { topicMastery, type MasteryQuestion, type TopicMastery } from "../core/topic-mastery";
import type ExaminerPlugin from "../main";
import { iconAction, section, textButton } from "./shared";

const TILE_LEVELS: Record<TileState, number> = {
	solid: 4,
	shaky: 2,
	weak: 1,
	unseen: 0,
};

export function renderExamBoard(
	parent: HTMLElement,
	plugin: ExaminerPlugin,
	upcomingExams: readonly UpcomingExam[],
	attempts: readonly PrepAttempt[],
	mocks: readonly AttemptSummary[],
	now: Date,
	selectedExamId: string | null,
	onSelectExam: (examId: string) => void,
): void {
	const block = parent.createDiv({ cls: "examiner-block" });
	const remaining = remainingUpcomingExams(upcomingExams, now);
	let examIndex = remaining.findIndex((candidate) => candidate.id === selectedExamId);
	if (examIndex === -1) examIndex = 0;
	const exam = remaining[examIndex];
	if (!exam) {
		renderAddRow(block, plugin, upcomingExams);
		return;
	}

	const scope = scopeQuestionIds(
		exam,
		(examId) => plugin.exams.get(examId),
		(questionId) => {
			const question = plugin.questions.get(questionId);
			if (!question) return false;
			return plugin.questionIsUsable(question);
		},
	);
	const predictionQuestions: PredictionQuestion[] = [];
	const masteryQuestions: MasteryQuestion[] = [];
	for (const questionId of scope) {
		const question = plugin.questions.get(questionId);
		if (!question) continue;
		predictionQuestions.push({ questionId, marks: question.marks });
		masteryQuestions.push({ questionId, tags: question.tags });
	}

	const board = buildExamBoard(exam, scope, attempts, now);
	const prediction = predictExam(exam.date, exam.examIds, predictionQuestions, attempts, mocks, now);
	const change = predictionChangeToday(exam.date, exam.examIds, predictionQuestions, attempts, mocks, now);

	const card = block.createDiv({ cls: "examiner-next-step examiner-board" });
	renderHeading(card, plugin, exam, board, remaining, examIndex, onSelectExam);
	renderPrediction(card, exam, prediction, change);
	card.createDiv({ cls: "examiner-row-meta", text: `Exam-day memory ${prediction.memory}%` });
	renderTiles(card, plugin, board.tiles);
	renderToday(card, plugin, board);

	if (masteryQuestions.length > 0) renderTopics(parent, topicMastery(masteryQuestions, attempts));
}

function renderAddRow(block: HTMLElement, plugin: ExaminerPlugin, upcomingExams: readonly UpcomingExam[]): void {
	const row = block.createDiv({ cls: "examiner-header-actions" });
	textButton(row, "Add upcoming exam").addEventListener("click", () => void plugin.openUpcomingExamEditor());
	const [first] = upcomingExams;
	if (first) renderEditAction(row, plugin, first);
}

function renderExamArrows(parent: HTMLElement, remaining: readonly UpcomingExam[], examIndex: number, onSelectExam: (examId: string) => void): void {
	const previousExam = remaining[examIndex - 1];
	const previous = iconAction(parent, "chevron-left", "Previous upcoming exam");
	previous.disabled = previousExam === undefined;
	if (previousExam) previous.addEventListener("click", () => onSelectExam(previousExam.id));

	parent.createSpan({ cls: "examiner-row-meta", text: `${examIndex + 1}/${remaining.length}` });

	const nextExam = remaining[examIndex + 1];
	const next = iconAction(parent, "chevron-right", "Next upcoming exam");
	next.disabled = nextExam === undefined;
	if (nextExam) next.addEventListener("click", () => onSelectExam(nextExam.id));
}

function renderHeading(
	card: HTMLElement,
	plugin: ExaminerPlugin,
	exam: UpcomingExam,
	board: ExamBoard,
	remaining: readonly UpcomingExam[],
	examIndex: number,
	onSelectExam: (examId: string) => void,
): void {
	const row = card.createDiv({ cls: "examiner-board-row" });
	const heading = row.createDiv({ cls: "examiner-board-side" });
	if (remaining.length > 1) renderExamArrows(heading, remaining, examIndex, onSelectExam);
	heading.createDiv({ cls: "examiner-row-title", text: exam.title });
	const side = row.createDiv({ cls: "examiner-board-side" });
	side.createSpan({ cls: "examiner-row-meta", text: board.daysLeft === 1 ? "1 day" : `${board.daysLeft} days` });
	const add = iconAction(side, "plus", "Add upcoming exam");
	add.addEventListener("click", () => void plugin.openUpcomingExamEditor());
	renderEditAction(side, plugin, exam);
}

function renderEditAction(parent: HTMLElement, plugin: ExaminerPlugin, exam: UpcomingExam): void {
	const edit = iconAction(parent, "square-pen", "Edit upcoming exam");
	edit.addEventListener("click", () => void plugin.openUpcomingExamEditor(exam.id));
}

function renderPrediction(card: HTMLElement, exam: UpcomingExam, prediction: ExamPrediction, change: number): void {
	const row = card.createDiv({ cls: "examiner-board-row" });
	const predicted = row.createDiv({ cls: "examiner-board-side" });
	predicted.createSpan({ text: `Predicted ${prediction.predicted}%` });
	if (change !== 0) predicted.createSpan({ cls: "examiner-row-meta", text: formatSignedPercent(change) });
	row.createSpan({ cls: "examiner-row-meta", text: `Target grade ${exam.targetPercent}%` });
}

function renderTiles(card: HTMLElement, plugin: ExaminerPlugin, tiles: readonly BoardTile[]): void {
	const grid = card.createDiv({ cls: "examiner-board-tiles" });
	for (const tile of tiles) {
		const title = plugin.questions.get(tile.questionId)?.title || "Untitled question";
		grid.createDiv({
			cls: `examiner-heatmap-cell is-level-${TILE_LEVELS[tile.state]}`,
			attr: { title },
		});
	}
}

function renderToday(card: HTMLElement, plugin: ExaminerPlugin, board: ExamBoard): void {
	const row = card.createDiv({ cls: "examiner-board-row" });
	row.createSpan({ text: `Today ${board.todayDone}/${board.todayGoal}` });
	const button = textButton(row, "Continue", true);
	const nextQuestionId = board.nextQuestionId;
	if (nextQuestionId === null) {
		button.disabled = true;
		return;
	}
	button.addEventListener("click", () => void plugin.openPractice(nextQuestionId));
}

function renderTopics(parent: HTMLElement, topics: readonly TopicMastery[]): void {
	const list = section(parent, "Topics").createDiv({ cls: "examiner-bars" });
	for (const topic of topics) {
		const row = list.createDiv({ cls: "examiner-bar-row" });
		row.createSpan({ cls: "examiner-bar-label", text: topic.tag, attr: { title: topic.tag } });
		const track = row.createDiv({ cls: "examiner-bar-track" });
		track.createDiv({ cls: "examiner-bar-fill" }).setCssProps({ "--examiner-share": `${topic.percent}%` });
		row.createSpan({ cls: "examiner-bar-value", text: `${topic.percent}%` });
		setTooltip(track, `${topic.tag}: ${topic.percent}%`);
	}
}
