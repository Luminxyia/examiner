import { describe, expect, it } from "vitest";
import type { PrepAttempt } from "../src/core/exam-prep";
import {
	DEFAULT_AFTER_MISS_RATE,
	DEFAULT_FIRST_ATTEMPT_RATE,
	personalRates,
	predictExam,
	predictionChangeToday,
	questionChance,
	recallChance,
	stabilityOf,
} from "../src/core/prediction";
import { addLocalDays, localDayKey, type AttemptSummary } from "../src/core/statistics";
import { daysAgo, NOW } from "./helpers";

function attempt(questionId: string, days: number, correct: boolean): PrepAttempt {
	return { questionId, at: daysAgo(days), correct };
}

function mock(examId: string, days: number, percent: number): AttemptSummary {
	return { id: `${examId}-${days}`, examId, examTitle: examId, submittedAt: daysAgo(days), correct: 0, total: 1, marks: 0, maxMarks: 1, percent };
}

const examDate = localDayKey(addLocalDays(NOW, 12));
const examDay = addLocalDays(NOW, 12);
const defaults = { firstAttempt: DEFAULT_FIRST_ATTEMPT_RATE, afterMiss: DEFAULT_AFTER_MISS_RATE };

describe("recall chance", () => {
	it("is 90% when the days equal the stability", () => {
		expect(recallChance(10, 10)).toBeCloseTo(0.9);
	});

	it("matches the worked example", () => {
		expect(recallChance(12, 10)).toBeCloseTo(0.883, 2);
	});

	it("does not go above 100% for a date in the past", () => {
		expect(recallChance(-5, 10)).toBe(1);
	});
});

describe("stability", () => {
	it("starts at three days after the first correct answer", () => {
		expect(stabilityOf([attempt("a", 3, true)])).toBe(3);
	});

	it("does not grow from repeats on one day", () => {
		expect(stabilityOf([attempt("a", 3, true), attempt("a", 3, true)])).toBe(3);
	});

	it("multiplies by 2.5 when correct on a new day", () => {
		expect(stabilityOf([attempt("a", 5, true), attempt("a", 3, true)])).toBe(7.5);
	});

	it("halves when wrong, down to one day", () => {
		expect(stabilityOf([attempt("a", 5, true), attempt("a", 3, false)])).toBe(1.5);
		expect(stabilityOf([attempt("a", 5, true), attempt("a", 3, false), attempt("a", 2, false), attempt("a", 1, false)])).toBe(1);
	});

	it("stays at zero until something is answered correctly", () => {
		expect(stabilityOf([attempt("a", 5, false)])).toBe(0);
	});
});

describe("personal rates", () => {
	it("uses the defaults with too few examples", () => {
		expect(personalRates([attempt("a", 5, true), attempt("b", 5, false), attempt("b", 4, true)])).toEqual(defaults);
	});

	it("uses your own first attempt rate from ten examples", () => {
		const attempts: PrepAttempt[] = [];
		for (let index = 0; index < 10; index++) attempts.push(attempt(`q${index}`, 5, index < 8));
		expect(personalRates(attempts).firstAttempt).toBeCloseTo(0.8);
	});

	it("uses your own rate after a miss from ten examples", () => {
		const attempts: PrepAttempt[] = [];
		for (let index = 0; index < 10; index++) {
			attempts.push(attempt(`q${index}`, 5, false));
			attempts.push(attempt(`q${index}`, 4, index < 6));
		}
		expect(personalRates(attempts).afterMiss).toBeCloseTo(0.6);
	});
});

describe("question chance", () => {
	it("uses the first attempt rate for an unseen question", () => {
		expect(questionChance([], examDay, defaults)).toBe(DEFAULT_FIRST_ATTEMPT_RATE);
	});

	it("uses the rate after a miss however close the exam is", () => {
		expect(questionChance([attempt("a", 1, false)], examDay, defaults)).toBe(DEFAULT_AFTER_MISS_RATE);
	});

	it("uses the forgetting curve when last answered correctly", () => {
		const chance = questionChance([attempt("a", 0, true)], examDay, defaults);
		expect(chance).toBeGreaterThan(0.6);
		expect(chance).toBeLessThan(0.8);
	});
});

describe("predicted score", () => {
	const questions = Array.from({ length: 40 }, (_unused, index) => ({ questionId: `q${index}`, marks: 1 }));

	it("is memory alone with no mocks", () => {
		const prediction = predictExam(examDate, [], questions, [], [], NOW);
		expect(prediction.memory).toBe(50);
		expect(prediction.predicted).toBe(50);
	});

	it("blends two mocks equally with memory", () => {
		const prediction = predictExam(examDate, ["e"], questions, [], [mock("e", 1, 70), mock("e", 1, 70)], NOW);
		expect(prediction.predicted).toBe(60);
	});

	it("ignores mocks from other exams or outside the window", () => {
		const prediction = predictExam(examDate, ["e"], questions, [], [mock("other", 1, 90), mock("e", 31, 90)], NOW);
		expect(prediction.predicted).toBe(50);
	});

	it("gives a range around the prediction", () => {
		const prediction = predictExam(examDate, [], questions, [], [], NOW);
		expect(prediction.low).toBe(35);
		expect(prediction.high).toBe(65);
	});

	it("counts questions by their marks", () => {
		const weighted = [
			{ questionId: "big", marks: 9 },
			{ questionId: "small", marks: 1 },
		];
		const prediction = predictExam(examDate, [], weighted, [attempt("big", 1, false)], [], NOW);
		expect(prediction.memory).toBe(32);
	});

	it("keeps the range between 0 and 100", () => {
		const prediction = predictExam(examDate, [], [{ questionId: "a", marks: 1 }], [], [], NOW);
		expect(prediction.low).toBe(0);
		expect(prediction.high).toBe(100);
	});

	it("handles an empty scope", () => {
		expect(predictExam(examDate, [], [], [], [], NOW)).toEqual({ predicted: 0, low: 0, high: 0, memory: 0 });
	});

	it("does not drift as days pass without answering", () => {
		const history = [attempt("q0", 10, true)];
		const today = predictExam(examDate, [], questions, history, [], NOW);
		const later = predictExam(examDate, [], questions, history, [], addLocalDays(NOW, 5));
		expect(later.predicted).toBe(today.predicted);
	});
});

describe("change today", () => {
	const questions = [{ questionId: "a", marks: 1 }];

	it("is zero with no new evidence today", () => {
		expect(predictionChangeToday(examDate, [], questions, [attempt("a", 3, true)], [], NOW)).toBe(0);
	});

	it("rises after a correct answer today", () => {
		expect(predictionChangeToday(examDate, [], questions, [attempt("a", 0, true)], [], NOW)).toBeGreaterThan(0);
	});

	it("falls after a wrong answer today", () => {
		expect(predictionChangeToday(examDate, [], questions, [attempt("a", 3, true), attempt("a", 0, false)], [], NOW)).toBeLessThan(0);
	});

	it("includes a mock taken today", () => {
		expect(predictionChangeToday(examDate, ["e"], questions, [], [mock("e", 0, 100)], NOW)).toBeGreaterThan(0);
	});
});
