import { describe, expect, it } from "vitest";
import type { PrepAttempt } from "../src/core/exam-prep";
import { topicMastery, updateMastery } from "../src/core/topic-mastery";
import { daysAgo } from "./helpers";

function attempt(questionId: string, days: number, correct: boolean): PrepAttempt {
	return { questionId, at: daysAgo(days), correct };
}

describe("updating mastery", () => {
	it("matches the worked examples", () => {
		expect(updateMastery(0.3, true)).toBeCloseTo(0.71, 2);
		expect(updateMastery(0.3, false)).toBeCloseTo(0.19, 2);
	});

	it("stays between 0 and 1 after many answers", () => {
		let high = 0.3;
		let low = 0.3;
		for (let index = 0; index < 50; index++) {
			high = updateMastery(high, true);
			low = updateMastery(low, false);
		}
		expect(high).toBeLessThanOrEqual(1);
		expect(low).toBeGreaterThanOrEqual(0);
		expect(high).toBeGreaterThan(low);
	});
});

describe("topic mastery", () => {
	it("starts every topic at 30%", () => {
		expect(topicMastery([{ questionId: "a", tags: ["Moments"] }], [])).toEqual([{ tag: "Moments", percent: 30 }]);
	});

	it("sorts strongest first", () => {
		const questions = [
			{ questionId: "a", tags: ["Stress"] },
			{ questionId: "b", tags: ["Moments"] },
		];
		const result = topicMastery(questions, [attempt("a", 2, false), attempt("b", 2, true)]);
		expect(result).toEqual([
			{ tag: "Moments", percent: 71 },
			{ tag: "Stress", percent: 19 },
		]);
	});

	it("updates every tag on a question and groups tags ignoring case", () => {
		const questions = [
			{ questionId: "a", tags: ["Moments", "Statics"] },
			{ questionId: "b", tags: ["moments"] },
		];
		const result = topicMastery(questions, [attempt("a", 2, true)]);
		expect(result).toEqual([
			{ tag: "Moments", percent: 71 },
			{ tag: "Statics", percent: 71 },
		]);
	});

	it("groups questions without tags as Untagged", () => {
		expect(topicMastery([{ questionId: "a", tags: [] }], [])).toEqual([{ tag: "Untagged", percent: 30 }]);
	});

	it("ignores attempts at questions outside the exam", () => {
		const result = topicMastery([{ questionId: "a", tags: ["Moments"] }], [attempt("other", 2, true)]);
		expect(result).toEqual([{ tag: "Moments", percent: 30 }]);
	});
});
