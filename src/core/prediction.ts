import { parseLocalDate, type PrepAttempt } from "./exam-prep";
import { weightedRecentScore } from "./insights";
import { localDayKey, startOfLocalDay, type AttemptSummary } from "./statistics";

export interface PredictionQuestion {
	questionId: string;
	marks: number;
}

export interface ExamPrediction {
	predicted: number;
	low: number;
	high: number;
	memory: number;
}

export interface PersonalRates {
	firstAttempt: number;
	afterMiss: number;
}

export const INITIAL_STABILITY_DAYS = 3;

export const STABILITY_GROWTH = 2.5;

export const STABILITY_LOSS = 0.5;

export const MINIMUM_STABILITY_DAYS = 1;

export const DEFAULT_FIRST_ATTEMPT_RATE = 0.5;

export const DEFAULT_AFTER_MISS_RATE = 0.3;

export const MINIMUM_RATE_EXAMPLES = 10;

export const MOCK_WINDOW_DAYS = 30;

export const MOCK_BLEND_CONSTANT = 2;

export const RANGE_Z_SCORE = 1.96;

const FORGETTING_FACTOR = 19 / 81;

const FORGETTING_DECAY = -0.5;

const DAY_MS = 86_400_000;

export function recallChance(daysSinceCorrect: number, stability: number): number {
	const days = Math.max(0, daysSinceCorrect);
	return (1 + (FORGETTING_FACTOR * days) / stability) ** FORGETTING_DECAY;
}

export function stabilityOf(attempts: readonly PrepAttempt[]): number {
	let stability = 0;
	let lastCorrectDay = "";
	for (const attempt of attempts) {
		if (!attempt.correct) {
			if (stability > 0) stability = Math.max(MINIMUM_STABILITY_DAYS, stability * STABILITY_LOSS);
			continue;
		}
		const day = localDayKey(new Date(attempt.at));
		if (stability === 0) {
			stability = INITIAL_STABILITY_DAYS;
		} else if (day !== lastCorrectDay) {
			stability = stability * STABILITY_GROWTH;
		}
		lastCorrectDay = day;
	}
	return stability;
}

function groupByQuestion(attempts: readonly PrepAttempt[]): Map<string, PrepAttempt[]> {
	const grouped = new Map<string, PrepAttempt[]>();
	for (const attempt of attempts) {
		const list = grouped.get(attempt.questionId) ?? [];
		list.push(attempt);
		grouped.set(attempt.questionId, list);
	}
	return grouped;
}

function rateOrDefault(successes: number, examples: number, fallback: number): number {
	if (examples < MINIMUM_RATE_EXAMPLES) return fallback;
	return successes / examples;
}

export function personalRates(attempts: readonly PrepAttempt[]): PersonalRates {
	let firstAttempts = 0;
	let firstAttemptsCorrect = 0;
	let afterMisses = 0;
	let afterMissesCorrect = 0;

	for (const history of groupByQuestion(attempts).values()) {
		history.forEach((attempt, index) => {
			if (index === 0) {
				firstAttempts++;
				if (attempt.correct) firstAttemptsCorrect++;
				return;
			}
			const previous = history[index - 1];
			if (!previous || previous.correct) return;
			afterMisses++;
			if (attempt.correct) afterMissesCorrect++;
		});
	}

	return {
		firstAttempt: rateOrDefault(firstAttemptsCorrect, firstAttempts, DEFAULT_FIRST_ATTEMPT_RATE),
		afterMiss: rateOrDefault(afterMissesCorrect, afterMisses, DEFAULT_AFTER_MISS_RATE),
	};
}

export function questionChance(attempts: readonly PrepAttempt[], examDay: Date, rates: PersonalRates): number {
	const latest = attempts[attempts.length - 1];
	if (!latest) return rates.firstAttempt;
	if (!latest.correct) return rates.afterMiss;
	const daysSinceCorrect = (examDay.getTime() - Date.parse(latest.at)) / DAY_MS;
	return recallChance(daysSinceCorrect, stabilityOf(attempts));
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function recentMocks(mocks: readonly AttemptSummary[], examIds: readonly string[], moment: Date): AttemptSummary[] {
	return mocks.filter((mock) => {
		if (!examIds.includes(mock.examId)) return false;
		const ageInDays = (moment.getTime() - Date.parse(mock.submittedAt)) / DAY_MS;
		return ageInDays >= 0 && ageInDays <= MOCK_WINDOW_DAYS;
	});
}

export function predictExam(
	examDate: string,
	examIds: readonly string[],
	questions: readonly PredictionQuestion[],
	attempts: readonly PrepAttempt[],
	mocks: readonly AttemptSummary[],
	moment: Date,
): ExamPrediction {
	const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
	const examDay = parseLocalDate(examDate);
	if (totalMarks === 0 || examDay === null) return { predicted: 0, low: 0, high: 0, memory: 0 };

	const rates = personalRates(attempts);
	const grouped = groupByQuestion(attempts);
	let expectedMarks = 0;
	let variance = 0;
	for (const question of questions) {
		const chance = questionChance(grouped.get(question.questionId) ?? [], examDay, rates);
		expectedMarks += question.marks * chance;
		variance += question.marks * question.marks * chance * (1 - chance);
	}
	const memory = (expectedMarks / totalMarks) * 100;
	const spread = (Math.sqrt(variance) / totalMarks) * 100;

	const usedMocks = recentMocks(mocks, examIds, moment);
	const mockWeight = usedMocks.length / (usedMocks.length + MOCK_BLEND_CONSTANT);
	const mockAverage = weightedRecentScore(usedMocks, moment);
	const predicted = mockWeight * mockAverage + (1 - mockWeight) * memory;

	return {
		predicted: Math.round(predicted),
		low: Math.round(clampPercent(predicted - RANGE_Z_SCORE * spread)),
		high: Math.round(clampPercent(predicted + RANGE_Z_SCORE * spread)),
		memory: Math.round(memory),
	};
}

export function predictionChangeToday(
	examDate: string,
	examIds: readonly string[],
	questions: readonly PredictionQuestion[],
	attempts: readonly PrepAttempt[],
	mocks: readonly AttemptSummary[],
	now: Date,
): number {
	const startOfToday = startOfLocalDay(now);
	const attemptsBeforeToday = attempts.filter((attempt) => Date.parse(attempt.at) < startOfToday.getTime());
	const mocksBeforeToday = mocks.filter((mock) => Date.parse(mock.submittedAt) < startOfToday.getTime());
	const current = predictExam(examDate, examIds, questions, attempts, mocks, now);
	const earlier = predictExam(examDate, examIds, questions, attemptsBeforeToday, mocksBeforeToday, startOfToday);
	return current.predicted - earlier.predicted;
}
