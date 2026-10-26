import { describe, expect, it } from "vitest";
import { aggregateMistakes, aggregateTopics, describeMisses, recencyWeight } from "../src/core/insights";
import { attemptOf, daysAgo, item, NOW } from "./helpers";

describe("mistake aggregation", () => {
	const attempts = [
		attemptOf("a1", "maths", 20, [item("log", "incorrect", ["logarithms"]), item("diff", "incorrect", ["calculus"]), item("sum", "correct")]),
		attemptOf("a2", "maths", 10, [item("log", "incorrect", ["logarithms"]), item("diff", "correct", ["calculus"]), item("sum", "unanswered")]),
		attemptOf("a3", "maths", 2, [item("log", "incorrect", ["logarithms"]), item("cap", "incorrect", ["capacitors"])]),
	];
	const mistakes = aggregateMistakes(attempts, NOW);

	it("counts misses per question across attempts", () => {
		const byId = new Map(mistakes.map((entry) => [entry.questionId, entry]));
		expect(byId.get("log")).toMatchObject({ missedAttempts: 3, seenAttempts: 3, correctSinceLastMiss: false });
		expect(byId.get("diff")).toMatchObject({ missedAttempts: 1, seenAttempts: 2, correctSinceLastMiss: true });
		expect(byId.get("cap")).toMatchObject({ missedAttempts: 1, seenAttempts: 1 });
	});

	it("does not treat unanswered or correct questions as mistakes", () => {
		expect(mistakes.map((entry) => entry.questionId)).not.toContain("sum");
	});

	it("ranks repeated mistakes above isolated ones", () => {
		expect(mistakes[0]?.questionId).toBe("log");
	});

	it("gives recent mistakes more weight than old ones", () => {
		const recentFirst = mistakes.findIndex((entry) => entry.questionId === "cap");
		const resolved = mistakes.findIndex((entry) => entry.questionId === "diff");
		expect(recentFirst).toBeLessThan(resolved);
		expect(recencyWeight(daysAgo(0), NOW)).toBeCloseTo(1);
		expect(recencyWeight(daysAgo(30), NOW)).toBeCloseTo(0.5);
	});

	it("lets a recent single miss outrank an old repeated one", () => {
		const ranked = aggregateMistakes(
			[
				attemptOf("o1", "e", 200, [item("old", "incorrect")]),
				attemptOf("o2", "e", 190, [item("old", "incorrect")]),
				attemptOf("n1", "e", 1, [item("new", "incorrect")]),
			],
			NOW,
		);
		expect(ranked.map((entry) => entry.questionId)).toEqual(["new", "old"]);
	});

	it("counts a question once per attempt even when it appears several times", () => {
		const [entry] = aggregateMistakes([attemptOf("x", "e", 1, [item("q", "incorrect"), item("q", "incorrect"), item("q", "correct")])], NOW);
		expect(entry).toMatchObject({ missedAttempts: 1, seenAttempts: 1 });
	});

	it("records partly correct answers separately from misses", () => {
		const [entry] = aggregateMistakes([attemptOf("x", "e", 1, [item("q", "partial")]), attemptOf("y", "e", 0, [item("q", "incorrect")])], NOW);
		expect(entry).toMatchObject({ missedAttempts: 1, partialAttempts: 1 });
		expect(describeMisses(entry ?? { missedAttempts: 0, partialAttempts: 0 })).toBe("missed once, partly correct once");
	});

	it("keeps the latest missed answer for review", () => {
		const [entry] = aggregateMistakes(
			[attemptOf("x", "old-exam", 5, [item("q", "incorrect")], "Old title"), attemptOf("y", "new-exam", 1, [item("q", "incorrect")], "New title")],
			NOW,
		);
		expect(entry).toMatchObject({ examId: "new-exam", examTitle: "New title", lastMissedAt: daysAgo(1) });
		expect(entry?.example.prompt).toBe("Prompt for q");
	});

	it("returns nothing when there are no mistakes", () => {
		expect(aggregateMistakes([], NOW)).toEqual([]);
		expect(aggregateMistakes([attemptOf("x", "e", 1, [item("q", "correct"), item("r", "unknown")])], NOW)).toEqual([]);
	});
});

describe("topic aggregation", () => {
	it("groups mistakes by their tags without inventing topics", () => {
		const mistakes = aggregateMistakes(
			[
				attemptOf("a", "e", 3, [item("q1", "incorrect", ["Logarithms"]), item("q2", "incorrect", ["logarithms", "algebra"]), item("q3", "incorrect")]),
				attemptOf("b", "e", 1, [item("q1", "incorrect", ["Logarithms"])]),
			],
			NOW,
		);
		const topics = aggregateTopics(mistakes);
		expect(topics.map((topic) => [topic.tag, topic.questions, topic.misses])).toEqual([
			["Logarithms", 2, 3],
			["algebra", 1, 1],
		]);
	});
});
