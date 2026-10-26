import { describe, expect, it } from "vitest";
import type { ItemOutcome } from "../src/core/exam";
import { aggregateMistakes, recommendNext, selectTargetedQuestions, studyPriorities, type InsightAttempt } from "../src/core/insights";
import { groupAttemptsByExam, type AttemptSummary } from "../src/core/statistics";
import { attemptOf, item, NOW } from "./helpers";

function summary(record: InsightAttempt): AttemptSummary {
	const correct = record.items.filter((entry) => entry.outcome === "correct").length;
	const total = record.items.length;
	return {
		id: record.id,
		examId: record.examId,
		examTitle: record.examTitle,
		submittedAt: record.submittedAt,
		correct,
		total,
		marks: correct,
		maxMarks: total,
		percent: total === 0 ? 0 : (correct / total) * 100,
	};
}

function scored(id: string, examId: string, days: number, correct: number, total = 4, wrong: string[] = []): InsightAttempt {
	const outcomes: [string, ItemOutcome][] = [];
	for (let index = 0; index < total; index++) {
		const questionId = wrong[index] ?? `${examId}-q${index}`;
		outcomes.push([questionId, index < total - correct ? "incorrect" : "correct"]);
	}
	return attemptOf(id, examId, days, outcomes.map(([questionId, outcome]) => item(questionId, outcome, ["topic"])));
}

function priorities(records: InsightAttempt[], passing = 40) {
	return studyPriorities(groupAttemptsByExam(records.map(summary)), records, () => passing, NOW);
}

describe("study priorities", () => {
	it("does not judge an exam from a single attempt, however low or high", () => {
		const [low, high] = priorities([scored("a", "low", 1, 0, 10), scored("b", "high", 1, 10, 10)]);
		expect(low).toMatchObject({ status: "not-enough-evidence", action: "gather-evidence", reasons: ["Based on 1 attempt"] });
		expect(low?.trend).toEqual({ kind: "none", reason: "single-attempt" });
		expect(high?.status).toBe("not-enough-evidence");
	});

	it("asks for more data when only a few questions have been answered", () => {
		const [entry] = priorities([scored("a", "short", 3, 0, 2), scored("b", "short", 1, 0, 2)]);
		expect(entry).toMatchObject({ status: "not-enough-evidence", reasons: [] });
	});

	it("counts every answered copy of a repeated question as evidence", () => {
		const repeated = (id: string, days: number, wrong: number) =>
			attemptOf(
				id,
				"drill",
				days,
				Array.from({ length: 10 }, (_, index) => item("q-same", index < wrong ? "incorrect" : "correct")),
			);
		const [entry] = priorities([repeated("a", 9, 0), repeated("b", 5, 2), repeated("c", 1, 1)]);
		expect(entry?.questionsAnswered).toBe(30);
		expect(entry?.status).not.toBe("not-enough-evidence");
		expect(entry?.mistakes[0]).toMatchObject({ questionId: "q-same", missedAttempts: 2 });
	});

	it("does not count unanswered or I don't know as evidence", () => {
		const skipped = (id: string, days: number) =>
			attemptOf(id, "skips", days, [item("a", "correct"), item("b", "unanswered"), item("c", "unknown"), item("d", "correct")]);
		const [entry] = priorities([skipped("a", 3), skipped("b", 1)]);
		expect(entry).toMatchObject({ questionsAnswered: 4, status: "not-enough-evidence", reasons: [] });
	});

	it("flags exams that stay below the passing grade", () => {

		const [entry] = priorities([scored("a", "maths", 10, 1), scored("b", "maths", 2, 1)]);
		expect(entry?.status).toBe("needs-attention");
		expect(entry?.action).toBe("review-mistakes");
		expect(entry?.reasons).toContain("Latest score is below the passing grade of 40%");
	});

	it("explains a recent decline as a percentage of the previous score", () => {
		const [entry] = priorities([scored("a", "maths", 10, 3), scored("b", "maths", 2, 2)], 40);
		expect(entry?.status).toBe("needs-attention");
		expect(entry?.reasons).toContain("Recent score decreased (-33%)");
	});

	it("acknowledges strong, improving results only with two strong attempts", () => {
		const [entry] = priorities([scored("a", "phys", 10, 9, 10), scored("b", "phys", 2, 10, 10)]);
		expect(entry?.status).toBe("performing-well");
		expect(entry?.reasons).toEqual(["Recent score increased (+11%)", "At least 80% in the last two attempts"]);
	});

	it("prioritises questions missed again and again even when scores pass", () => {
		const records = [
			scored("a", "elec", 12, 8, 10, ["cap", "res"]),
			scored("b", "elec", 4, 8, 10, ["cap", "res"]),
		];
		const [entry] = priorities(records);
		expect(entry?.status).toBe("needs-attention");
		expect(entry?.reasons).toContain("2 questions missed more than once");
	});

	it("lists the exams that need attention first", () => {
		const list = priorities([
			scored("a", "good", 9, 10, 10),
			scored("b", "good", 3, 10, 10),
			scored("c", "weak", 9, 1),
			scored("d", "weak", 3, 1),
			scored("e", "new", 1, 2),
		]);
		expect(list.map((entry) => [entry.examId, entry.status])).toEqual([
			["weak", "needs-attention"],
			["new", "not-enough-evidence"],
			["good", "performing-well"],
		]);
	});
});

describe("targeted exam selection", () => {
	const records = [
		attemptOf("a", "maths", 9, [item("log", "incorrect", ["logs"]), item("diff", "incorrect", ["calculus"]), item("gone", "incorrect", ["logs"])]),
		attemptOf("b", "maths", 2, [item("log", "incorrect", ["logs"]), item("diff", "correct", ["calculus"])]),
	];
	const mistakes = aggregateMistakes(records, NOW);
	const candidates = [
		{ id: "log", tags: ["logs"], title: "Logs" },
		{ id: "diff", tags: ["calculus"], title: "Diff" },
		{ id: "log2", tags: ["logs"], title: "More logs" },
		{ id: "trig", tags: ["trigonometry"], title: "Trig" },
	];

	it("starts with unresolved, high-priority mistakes that still exist", () => {
		const selection = selectTargetedQuestions(mistakes, candidates);
		expect(selection.questionIds.slice(0, 2)).toEqual(["log", "diff"]);
		expect(selection.questionIds).not.toContain("gone");
		expect(selection.fromMistakes).toBe(2);
	});

	it("tops up with other questions on the same topics, without unrelated ones or duplicates", () => {
		const selection = selectTargetedQuestions(mistakes, candidates);
		expect(selection.questionIds).toEqual(["log", "diff", "log2"]);
		expect(selection.fromTopics).toBe(1);
		expect(new Set(selection.questionIds).size).toBe(selection.questionIds.length);
	});

	it("respects the requested size", () => {
		expect(selectTargetedQuestions(mistakes, candidates, 1).questionIds).toEqual(["log"]);
	});

	it("returns nothing when no mistake questions are available", () => {
		expect(selectTargetedQuestions([], candidates)).toMatchObject({ questionIds: [], fromMistakes: 0, fromTopics: 0 });
		expect(selectTargetedQuestions(mistakes, [{ id: "trig", tags: ["trigonometry"], title: "Trig" }]).questionIds).toEqual([]);
	});
});

describe("continue studying", () => {
	const recommend = (records: InsightAttempt[], hasExams = true) =>
		recommendNext(priorities(records), aggregateMistakes(records, NOW), hasExams);

	it("points new users to their first exam", () => {
		expect(recommend([])).toMatchObject({ heading: "Take your first exam", actions: ["open-exams"] });
		expect(recommend([], false)).toMatchObject({ heading: "Create your first exam", actions: ["new-exam"] });
	});

	it("suggests reviewing and retrying after a comparable decline", () => {
		const result = recommend([scored("a", "maths", 10, 3), scored("b", "maths", 2, 2)]);
		expect(result).toMatchObject({ heading: "Ready to improve maths?", examId: "maths", actions: ["review-mistakes", "retry-exam"] });
		expect(result?.detail).toContain("dropped from 75% to 50%");
	});

	it("focuses on questions missed in more than one attempt", () => {
		const result = recommend([scored("a", "elec", 12, 9, 10, ["cap"]), scored("b", "elec", 4, 9, 10, ["cap"])]);
		expect(result).toMatchObject({ heading: "Revisit the questions you keep missing", actions: ["review-mistakes", "create-exam"] });
		expect(result?.mistakes.map((mistake) => mistake.questionId)).toEqual(["cap"]);
	});

	it("suggests targeted practice for one-off mistakes", () => {
		const result = recommend([scored("a", "elec", 12, 9, 10, ["cap"]), scored("b", "elec", 4, 9, 10, ["res"])]);
		expect(result).toMatchObject({ heading: "Practice what you got wrong", actions: ["create-exam", "review-mistakes"] });
	});

	it("acknowledges improvement while pointing at what is left", () => {
		const result = recommend([scored("a", "phys", 12, 7, 10, ["a", "b", "c"]), scored("b", "phys", 4, 9, 10, ["d"])]);
		expect(result?.heading).toBe("Keep the improvement going");
		expect(result?.detail).toContain("rose (+29%)");
	});

	it("asks for more data instead of judging a single attempt", () => {
		const result = recommend([scored("a", "new", 1, 10, 10)]);
		expect(result).toMatchObject({ heading: "Practice some more!", actions: ["retry-exam"], examId: "new" });
		expect(result?.detail).toBe("new does not have enough data to analyze trends");
	});

	it("suggests a refresher when results are consistently strong", () => {
		const result = recommend([scored("a", "good", 30, 10, 10), scored("b", "good", 20, 10, 10)]);
		expect(result).toMatchObject({ heading: "Outstanding", actions: ["retry-exam"], examId: "good" });
		expect(result?.detail).toBe("Your recent results on good were extraordinary");
	});

	it("changes as new attempts are recorded", () => {
		const before = recommend([scored("a", "maths", 10, 3), scored("b", "maths", 2, 2)]);
		const after = recommend([scored("a", "maths", 10, 3), scored("b", "maths", 2, 2), scored("c", "maths", 0, 4)]);
		expect(before?.heading).not.toBe(after?.heading);
	});
});
