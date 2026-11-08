import type { ValidationIssue } from "./definition";
import type { ExamDefinition } from "./exam";
import { questionResults, type InsightAttempt } from "./insights";
import { localDayKey, startOfLocalDay } from "./statistics";

export interface UpcomingExam {
	id: string;
	title: string;
	date: string;
	targetPercent: number;
	questionIds: string[];
	examIds: string[];
}

export type TileState = "solid" | "shaky" | "weak" | "unseen";

export interface PrepAttempt {
	questionId: string;
	at: string;
	correct: boolean;
}

export interface PracticeResult {
	questionId: string;
	submittedAt: string;
	correct: boolean;
}

export interface BoardTile {
	questionId: string;
	state: TileState;
}

export interface ExamBoard {
	daysLeft: number;
	tiles: BoardTile[];
	todayGoal: number;
	todayDone: number;
	nextQuestionId: string | null;
}

export const DEFAULT_TARGET_PERCENT = 75;

export const SOLID_CORRECT_DAYS = 2;

export const SOLID_FADE_DAYS = 14;

export const TILE_WORK: Record<TileState, number> = {
	weak: 2,
	unseen: 1,
	shaky: 1,
	solid: 0.5,
};

const TILE_ORDER: readonly TileState[] = ["solid", "shaky", "weak", "unseen"];

const NEXT_QUESTION_ORDER: readonly TileState[] = ["weak", "unseen", "shaky", "solid"];

const DAY_MS = 86_400_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(text: string): Date | null {
	const match = DATE_PATTERN.exec(text);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}

export function daysUntil(date: string, now: Date): number {
	const target = parseLocalDate(date);
	if (!target) return 0;
	const difference = target.getTime() - startOfLocalDay(now).getTime();
	return Math.round(difference / DAY_MS);
}

export function validateUpcomingExam(exam: UpcomingExam, now: Date): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (exam.title.trim() === "") {
		issues.push({ path: "title", severity: "error", message: "Give the exam a title." });
	}
	if (parseLocalDate(exam.date) === null) {
		issues.push({ path: "date", severity: "error", message: "Choose a date." });
	} else if (daysUntil(exam.date, now) < 0) {
		issues.push({ path: "date", severity: "error", message: "Choose a date that has not passed." });
	}
	const targetIsWhole = Number.isInteger(exam.targetPercent);
	if (!targetIsWhole || exam.targetPercent < 1 || exam.targetPercent > 100) {
		issues.push({ path: "targetPercent", severity: "error", message: "The target grade must be a whole number from 1 to 100." });
	}
	if (exam.questionIds.length === 0 && exam.examIds.length === 0) {
		issues.push({ path: "questions", severity: "error", message: "Add at least one question or exam." });
	}
	return issues;
}

export function remainingUpcomingExams(exams: readonly UpcomingExam[], now: Date): UpcomingExam[] {
	const remaining = exams.filter((exam) => daysUntil(exam.date, now) >= 0);
	remaining.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
	return remaining;
}

export function scopeQuestionIds(
	exam: UpcomingExam,
	findExam: (examId: string) => ExamDefinition | undefined,
	isUsable: (questionId: string) => boolean,
): string[] {
	const scope = new Set<string>();
	for (const questionId of exam.questionIds) {
		if (isUsable(questionId)) scope.add(questionId);
	}
	for (const examId of exam.examIds) {
		const definition = findExam(examId);
		if (!definition) continue;
		for (const ref of definition.questions) {
			if (isUsable(ref.questionId)) scope.add(ref.questionId);
		}
	}
	return [...scope];
}

export function collectPrepAttempts(examRecords: readonly InsightAttempt[], practiceResults: readonly PracticeResult[]): PrepAttempt[] {
	const attempts: PrepAttempt[] = [];
	for (const record of examRecords) {
		for (const [questionId, { result }] of questionResults(record)) {
			attempts.push({ questionId, at: record.submittedAt, correct: result === "correct" });
		}
	}
	for (const practice of practiceResults) {
		attempts.push({ questionId: practice.questionId, at: practice.submittedAt, correct: practice.correct });
	}
	attempts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	return attempts;
}

export function tileState(attempts: readonly PrepAttempt[], now: Date): TileState {
	const latest = attempts[attempts.length - 1];
	if (!latest) return "unseen";
	if (!latest.correct) return "weak";

	const correctDays = new Set<string>();
	for (let index = attempts.length - 1; index >= 0; index--) {
		const attempt = attempts[index];
		if (!attempt || !attempt.correct) break;
		correctDays.add(localDayKey(new Date(attempt.at)));
	}
	if (correctDays.size < SOLID_CORRECT_DAYS) return "shaky";

	const ageInDays = (now.getTime() - Date.parse(latest.at)) / DAY_MS;
	if (ageInDays > SOLID_FADE_DAYS) return "shaky";
	return "solid";
}

function attemptsByQuestion(attempts: readonly PrepAttempt[]): Map<string, PrepAttempt[]> {
	const grouped = new Map<string, PrepAttempt[]>();
	for (const attempt of attempts) {
		const list = grouped.get(attempt.questionId) ?? [];
		list.push(attempt);
		grouped.set(attempt.questionId, list);
	}
	return grouped;
}

function statesAt(questionIds: readonly string[], attempts: readonly PrepAttempt[], moment: Date): TileState[] {
	const grouped = attemptsByQuestion(attempts);
	return questionIds.map((questionId) => tileState(grouped.get(questionId) ?? [], moment));
}

function goalFor(states: readonly TileState[], daysLeft: number): number {
	let work = 0;
	for (const state of states) work += TILE_WORK[state];
	const days = Math.max(1, daysLeft);
	return Math.min(states.length, Math.ceil(work / days));
}

function sortedTiles(tiles: readonly BoardTile[]): BoardTile[] {
	const sorted: BoardTile[] = [];
	for (const state of TILE_ORDER) {
		for (const tile of tiles) {
			if (tile.state === state) sorted.push(tile);
		}
	}
	return sorted;
}

function lastAttemptTime(attempts: readonly PrepAttempt[] | undefined): number {
	if (!attempts) return 0;
	const latest = attempts[attempts.length - 1];
	if (!latest) return 0;
	return Date.parse(latest.at);
}

function chooseNextQuestion(tiles: readonly BoardTile[], attempts: readonly PrepAttempt[], doneToday: ReadonlySet<string>): string | null {
	const grouped = attemptsByQuestion(attempts);
	for (const state of NEXT_QUESTION_ORDER) {
		const candidates = tiles.filter((tile) => tile.state === state && !doneToday.has(tile.questionId));
		if (candidates.length === 0) continue;
		candidates.sort((a, b) => lastAttemptTime(grouped.get(a.questionId)) - lastAttemptTime(grouped.get(b.questionId)));
		const [first] = candidates;
		if (first) return first.questionId;
	}
	return null;
}

export function buildExamBoard(exam: UpcomingExam, questionIds: readonly string[], attempts: readonly PrepAttempt[], now: Date): ExamBoard {
	const startOfToday = startOfLocalDay(now);
	const daysLeft = daysUntil(exam.date, now);
	const attemptsBeforeToday = attempts.filter((attempt) => Date.parse(attempt.at) < startOfToday.getTime());

	const statesNow = statesAt(questionIds, attempts, now);
	const statesAtStartOfDay = statesAt(questionIds, attemptsBeforeToday, startOfToday);

	const tiles: BoardTile[] = [];
	questionIds.forEach((questionId, index) => {
		tiles.push({ questionId, state: statesNow[index] ?? "unseen" });
	});

	const scope = new Set(questionIds);
	const doneToday = new Set<string>();
	for (const attempt of attempts) {
		const inScope = scope.has(attempt.questionId);
		const isToday = Date.parse(attempt.at) >= startOfToday.getTime();
		if (inScope && isToday) doneToday.add(attempt.questionId);
	}

	return {
		daysLeft,
		tiles: sortedTiles(tiles),
		todayGoal: goalFor(statesAtStartOfDay, daysLeft),
		todayDone: doneToday.size,
		nextQuestionId: chooseNextQuestion(tiles, attempts, doneToday),
	};
}
