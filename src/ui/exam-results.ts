import type { App, Component } from "obsidian";
import { itemMarks, type ExamItemResult, type ItemOutcome } from "../core/exam";
import { workedSteps } from "../core/generate";
import { formatDuration } from "../core/statistics";
import type { ExamResultRecord } from "../storage/results";
import { renderOutcomeBar, renderScoreBars } from "./charts";
import {
	formatDateTime,
	formatMarks,
	formatPercent,
	formatScore,
	renderAnswerComparison,
	renderMarkdown,
	renderTags,
	renderWorking,
	section,
	textButton,
	type Tone,
} from "./shared";

type DisplayedOutcome = Exclude<ItemOutcome, "unknown">;

const OUTCOMES: readonly DisplayedOutcome[] = ["correct", "partial", "incorrect", "unanswered"];

const OUTCOME_TONES: Record<DisplayedOutcome, Tone> = {
	correct: "success",
	partial: "warning",
	incorrect: "error",
	unanswered: "muted",
};

export const OUTCOME_LABELS: Record<DisplayedOutcome, string> = {
	correct: "Correct",
	partial: "Partially correct",
	incorrect: "Incorrect",
	unanswered: "Unanswered",
};

function displayedOutcome(outcome: ItemOutcome): DisplayedOutcome {
	return outcome === "unknown" ? "unanswered" : outcome;
}

export interface ResultHeader {
	attemptLabel?: string;
	backLabel: string;
	onBack: () => void;
}

export async function renderExamResult(
	app: App,
	component: Component,
	root: HTMLElement,
	record: ExamResultRecord,
	header: ResultHeader,
): Promise<void> {
	const { summary } = record;
	const counts: Record<DisplayedOutcome, number> = {
		correct: summary.correct,
		partial: summary.partial ?? 0,
		incorrect: summary.incorrect,
		unanswered: summary.unanswered + (summary.unknown ?? 0),
	};

	const hero = root.createDiv({ cls: "examiner-result-hero" });
	const top = hero.createDiv({ cls: "examiner-result-top" });
	const title = [record.examTitle || "Untitled exam", header.attemptLabel].filter(Boolean).join(" ");
	top.createDiv({ cls: "examiner-eyebrow", text: title });
	textButton(top, header.backLabel).addEventListener("click", header.onBack);
	hero.createDiv({ cls: "examiner-score", text: formatPercent(summary.percent) });
	const marks = summary.marks ?? summary.correct;
	const maxMarks = summary.maxMarks ?? summary.total;
	hero.createDiv({ cls: "examiner-score-caption", text: `${formatMarks(marks)} of ${formatMarks(maxMarks)} ${maxMarks === 1 ? "mark" : "marks"}` });
	const details = [formatDateTime(record.submittedAt)];
	if (record.activeMs !== undefined) details.push(formatDuration(record.activeMs));
	if (record.timedOut) details.push("submitted automatically when time ran out");
	hero.createDiv({ cls: "examiner-muted examiner-small", text: details.join(", ") });
	renderOutcomeBar(
		hero,
		OUTCOMES.filter((outcome) => outcome !== "partial" || counts.partial > 0).map((outcome) => ({ label: OUTCOME_LABELS[outcome], value: counts[outcome], tone: OUTCOME_TONES[outcome] })),
	);

	const breakdown = root.createDiv({ cls: "examiner-result-columns" });
	renderScoreBars(section(breakdown, "By tag"), summary.byTag ?? []);
	renderScoreBars(
		section(breakdown, "By question"),
		(summary.byQuestion ?? []).map((group) => ({ ...group, label: group.label || "Untitled question" })),
	);

	const review = section(root, "Review");
	const list = review.createDiv({ cls: "examiner-review" });
	for (const [index, item] of record.items.entries()) await renderReviewItem(app, component, list, item, index);
}

async function renderReviewItem(app: App, component: Component, parent: HTMLElement, item: ExamItemResult, index: number): Promise<void> {
	const outcome = displayedOutcome(item.outcome);
	const details = parent.createEl("details", { cls: `examiner-review-item is-${outcome}` });
	const summary = details.createEl("summary");
	summary.createSpan({ cls: "examiner-review-number", text: String(index + 1) });
	summary.createSpan({ cls: "examiner-review-title", text: item.title || "Untitled question" });
	summary.createSpan({ cls: "examiner-review-marks", text: formatScore(item.awarded ?? (item.outcome === "correct" ? itemMarks(item) : 0), itemMarks(item)) });
	summary.createSpan({ cls: "examiner-status-label", text: OUTCOME_LABELS[outcome] });

	const body = details.createDiv({ cls: "examiner-review-body" });
	await renderMarkdown(app, body.createDiv({ cls: "examiner-prompt" }), item.prompt, component);
	if (item.instruction) body.createDiv({ cls: "examiner-instruction", text: item.instruction });
	const yourAnswer = outcome === "unanswered" ? "No answer" : item.response;
	if (item.kind === "flashcard") {
		renderAnswerComparison(body, yourAnswer, item.expectedDisplay);
		renderTags(body, item.tags);
		return;
	}
	renderAnswerComparison(body, yourAnswer, item.expectedDisplay, item.note);
	renderWorking(body, workedSteps({ inputs: item.inputs, steps: item.steps }), false);
	renderTags(body, item.tags);
}
