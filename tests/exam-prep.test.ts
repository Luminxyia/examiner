import { describe, expect, it } from "vitest";
import type { ExamDefinition } from "../src/core/exam";
import {
	buildExamBoard,
	collectPrepAttempts,
	daysUntil,
	remainingUpcomingExams,
	scopeQuestionIds,
	tileState,
	validateUpcomingExam,
	type PrepAttempt,
	type UpcomingExam,
} from "../src/core/exam-prep";
import { addLocalDays, localDayKey } from "../src/core/statistics";
import { attemptOf, daysAgo, item, NOW } from "./helpers";

function attempt(questionId: string, days: number, correct: boolean): PrepAttempt {
	return { questionId, at: daysAgo(days), correct };
}

function inDays(days: number): string {
	return localDayKey(addLocalDays(NOW, days));
}

function upcoming(overrides: Partial<UpcomingExam> = {}): UpcomingExam {
	return { id: "u-1", title: "Final", date: inDays(12), targetPercent: 75, questionIds: ["a"], examIds: [], ...overrides };
}

describe("tile state", () => {
	it("is unseen with no attempts", () => {
		expect(tileState([], NOW)).toBe("unseen");
	});

	it("is weak when the latest attempt was wrong", () => {
		expect(tileState([attempt("a", 5, true), attempt("a", 3, true), attempt("a", 1, false)], NOW)).toBe("weak");
	});

	it("is shaky after correct answers on only one day", () => {
		expect(tileState([attempt("a", 1, true), attempt("a", 1, true)], NOW)).toBe("shaky");
	});

	it("is solid after correct answers on two different days", () => {
		expect(tileState([attempt("a", 4, true), attempt("a", 1, true)], NOW)).toBe("solid");
	});

	it("only counts correct days since the last miss", () => {
		expect(tileState([attempt("a", 6, true), attempt("a", 4, false), attempt("a", 1, true)], NOW)).toBe("shaky");
	});

	it("fades solid to shaky after fourteen days", () => {
		expect(tileState([attempt("a", 20, true), attempt("a", 14, true)], NOW)).toBe("solid");
		expect(tileState([attempt("a", 20, true), attempt("a", 15, true)], NOW)).toBe("shaky");
	});
});

describe("collecting attempts", () => {
	it("treats don't know and blank exam answers as not correct", () => {
		const attempts = collectPrepAttempts(
			[attemptOf("r1", "e", 2, [item("known", "correct"), item("unsure", "unknown"), item("blank", "unanswered"), item("half", "partial")])],
			[],
		);
		const correctById = new Map(attempts.map((entry) => [entry.questionId, entry.correct]));
		expect(correctById.get("known")).toBe(true);
		expect(correctById.get("unsure")).toBe(false);
		expect(correctById.get("blank")).toBe(false);
		expect(correctById.get("half")).toBe(false);
	});

	it("merges practice results in time order", () => {
		const attempts = collectPrepAttempts([attemptOf("r1", "e", 2, [item("a", "incorrect")])], [
			{ questionId: "a", submittedAt: daysAgo(1), correct: true },
			{ questionId: "a", submittedAt: daysAgo(5), correct: true },
		]);
		expect(attempts.map((entry) => entry.correct)).toEqual([true, false, true]);
	});
});

describe("scope", () => {
	const exam: ExamDefinition = {
		id: "e-1",
		title: "Mock",
		tags: [],
		timeLimitMinutes: null,
		passingPercent: 50,
		questions: [
			{ questionId: "b", count: 3 },
			{ questionId: "a", count: 1 },
			{ questionId: "gone", count: 1 },
		],
	};

	it("combines questions and exams once each and drops unusable ones", () => {
		const scope = scopeQuestionIds(
			upcoming({ questionIds: ["a", "c"], examIds: ["e-1", "e-deleted"] }),
			(examId) => (examId === "e-1" ? exam : undefined),
			(questionId) => questionId !== "gone",
		);
		expect(scope).toEqual(["a", "c", "b"]);
	});
});

describe("choosing and validating upcoming exams", () => {
	it("counts whole days until the date", () => {
		expect(daysUntil(inDays(12), NOW)).toBe(12);
		expect(daysUntil(inDays(0), NOW)).toBe(0);
		expect(daysUntil(inDays(-1), NOW)).toBe(-1);
	});

	it("lists exams that have not passed, nearest first", () => {
		const exams = [upcoming({ id: "far", date: inDays(30) }), upcoming({ id: "past", date: inDays(-2) }), upcoming({ id: "near", date: inDays(3) })];
		expect(remainingUpcomingExams(exams, NOW).map((exam) => exam.id)).toEqual(["near", "far"]);
	});

	it("includes an exam taking place today", () => {
		expect(remainingUpcomingExams([upcoming({ id: "today", date: inDays(0) })], NOW).map((exam) => exam.id)).toEqual(["today"]);
	});

	it("is empty when every exam has passed", () => {
		expect(remainingUpcomingExams([upcoming({ date: inDays(-2) })], NOW)).toEqual([]);
	});

	it("accepts a complete exam", () => {
		expect(validateUpcomingExam(upcoming(), NOW)).toEqual([]);
	});

	it("rejects missing or invalid fields", () => {
		const issues = validateUpcomingExam(upcoming({ title: " ", date: "2026-02-31", targetPercent: 0, questionIds: [] }), NOW);
		expect(issues.map((issue) => issue.path)).toEqual(["title", "date", "targetPercent", "questions"]);
	});

	it("rejects a date that has passed", () => {
		expect(validateUpcomingExam(upcoming({ date: inDays(-1) }), NOW).map((issue) => issue.path)).toEqual(["date"]);
	});
});

describe("exam board", () => {
	const scope = ["unseen", "weak", "shaky", "solid"];
	const history = [
		attempt("weak", 2, false),
		attempt("shaky", 2, true),
		attempt("solid", 5, true),
		attempt("solid", 2, true),
	];

	it("orders tiles strongest first", () => {
		const board = buildExamBoard(upcoming(), scope, history, NOW);
		expect(board.tiles.map((tile) => tile.state)).toEqual(["solid", "shaky", "weak", "unseen"]);
		expect(board.daysLeft).toBe(12);
	});

	it("divides remaining work over the days left, rounding up", () => {
		expect(buildExamBoard(upcoming({ date: inDays(2) }), scope, history, NOW).todayGoal).toBe(3);
	});

	it("keeps today's goal fixed as questions are answered", () => {
		const before = buildExamBoard(upcoming({ date: inDays(2) }), scope, history, NOW);
		const after = buildExamBoard(upcoming({ date: inDays(2) }), scope, [...history, attempt("weak", 0, true)], NOW);
		expect(after.todayGoal).toBe(before.todayGoal);
		expect(after.todayDone).toBe(1);
	});

	it("never sets a goal larger than the number of questions", () => {
		const weakOnly = [attempt("a", 2, false), attempt("b", 2, false)];
		expect(buildExamBoard(upcoming({ date: inDays(0) }), ["a", "b"], weakOnly, NOW).todayGoal).toBe(2);
	});

	it("counts each question once towards today", () => {
		const board = buildExamBoard(upcoming(), scope, [...history, attempt("weak", 0, false), attempt("weak", 0, true), attempt("outside", 0, true)], NOW);
		expect(board.todayDone).toBe(1);
	});

	it("offers weak, then unseen, then shaky, then solid", () => {
		expect(buildExamBoard(upcoming(), scope, history, NOW).nextQuestionId).toBe("weak");
		expect(buildExamBoard(upcoming(), scope, [...history, attempt("weak", 0, true)], NOW).nextQuestionId).toBe("unseen");
	});

	it("prefers the question attempted longest ago within a group", () => {
		const attempts = [attempt("recent", 1, false), attempt("older", 6, false)];
		expect(buildExamBoard(upcoming(), ["recent", "older"], attempts, NOW).nextQuestionId).toBe("older");
	});

	it("offers nothing once every question was attempted today", () => {
		expect(buildExamBoard(upcoming(), ["a"], [attempt("a", 0, true)], NOW).nextQuestionId).toBeNull();
	});

	it("handles an empty scope", () => {
		const board = buildExamBoard(upcoming(), [], [], NOW);
		expect(board).toMatchObject({ todayGoal: 0, todayDone: 0, nextQuestionId: null });
	});
});
