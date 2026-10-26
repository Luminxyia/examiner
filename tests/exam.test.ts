import { describe, expect, it } from "vitest";
import {
	DEFAULT_PASSING_PERCENT,
	formatTimeLimit,
	isValidPassingPercent,
	LEGACY_PASSING_PERCENT,
	markExam,
	parseTimeLimit,
	prepareExam,
	summariseExam,
	validateExam,
	type CalculationItem,
	type ExamDefinition,
} from "../src/core/exam";
import { basicAddition, seededRandom } from "./helpers";

const addition = basicAddition({ id: "q-add", tags: ["maths", "arithmetic"] });
const pythagoras = basicAddition({
	id: "q-pyth",
	title: "Pythagorean theorem",
	prompt: "Sides {x} and {y}. Find the hypotenuse.",
	steps: [{ target: "answer", expression: "sqrt({x}^2 + {y}^2)" }],
	answer: { check: "rounded", places: 2 },
	tags: ["maths", "geometry"],
});
const broken = basicAddition({ id: "q-broken", title: "Broken", steps: [] });
const questions = new Map([addition, pythagoras, broken].map((q) => [q.id, q]));

const exam: ExamDefinition = {
	id: "e-1",
	title: "Mock",
	tags: [],
	timeLimitMinutes: 30,
	passingPercent: 50,
	questions: [
		{ questionId: "q-add", count: 2 },
		{ questionId: "q-pyth", count: 1 },
		{ questionId: "q-gone", count: 1 },
		{ questionId: "q-broken", count: 1 },
	],
};

describe("prepareExam", () => {
	const preparation = prepareExam(exam, (id) => questions.get(id), seededRandom(1));

	it("generates the requested number of separate instances", () => {
		expect(preparation.items.map((item) => item.questionId)).toEqual(["q-add", "q-add", "q-pyth"]);
		const [first, second] = preparation.items as CalculationItem[];
		expect(first?.instance).not.toBe(second?.instance);
	});

	it("reports missing and unusable questions instead of failing", () => {
		expect(preparation.missing).toEqual(["q-gone"]);
		expect(preparation.unusable.map((entry) => entry.title)).toEqual(["Broken"]);
	});

	it("snapshots the rule and tags so later edits cannot change marking", () => {
		const item = preparation.items[2] as CalculationItem | undefined;
		expect(item?.answerRule).toEqual({ check: "rounded", places: 2 });
		pythagoras.tags.push("changed-later");
		expect(item?.tags).toEqual(["maths", "geometry"]);
		pythagoras.tags.pop();
	});
});

describe("marking and scoring", () => {
	const items = prepareExam(exam, (id) => questions.get(id), seededRandom(2)).items as CalculationItem[];
	const [add1, , pyth] = items;

	const correctAdd = String(add1?.instance.answer);
	const correctPyth = (Math.round((pyth?.instance.answer ?? 0) * 100) / 100).toFixed(2);

	it("marks correct, incorrect and unanswered responses", () => {
		const results = markExam(items, [correctAdd, "  ", correctPyth]);
		expect(results.map((result) => result.outcome)).toEqual(["correct", "unanswered", "correct"]);
		const wrong = markExam(items, ["-1", "abc", "0"]);
		expect(wrong.map((result) => result.outcome)).toEqual(["incorrect", "incorrect", "incorrect"]);
		expect(wrong[1]?.note).toContain("is not a number");
	});

	it("treats missing responses as unanswered", () => {
		expect(markExam(items, []).every((result) => result.outcome === "unanswered")).toBe(true);
	});

	it("keeps I don't know apart from unanswered, even if a response was typed first", () => {
		const results = markExam(items, [correctAdd, "", ""], [true, false, true]);
		expect(results.map((result) => result.outcome)).toEqual(["unknown", "unanswered", "unknown"]);
		expect(results[0]?.response).toBe("");
		const summary = summariseExam(results);
		expect(summary).toMatchObject({ total: 3, correct: 0, incorrect: 0, unknown: 2, unanswered: 1, percent: 0 });
	});

	it("summarises by question and by tag, strongest tags first", () => {
		const summary = summariseExam(markExam(items, [correctAdd, "", "0"]));
		expect(summary).toMatchObject({ total: 3, correct: 1, incorrect: 1, unanswered: 1 });
		expect(summary.percent).toBeCloseTo(100 / 3, 10);
		expect(summary.byQuestion).toEqual([
			{ label: "Basic addition", correct: 1, total: 2 },
			{ label: "Pythagorean theorem", correct: 0, total: 1 },
		]);
		expect(summary.byTag).toEqual([
			{ label: "arithmetic", correct: 1, total: 2 },
			{ label: "maths", correct: 1, total: 3 },
			{ label: "geometry", correct: 0, total: 1 },
		]);
	});

	it("handles an empty exam", () => {
		expect(summariseExam([])).toMatchObject({ total: 0, percent: 0, byTag: [] });
	});

	it("groups untagged questions", () => {
		const untagged = prepareExam(
			{ ...exam, questions: [{ questionId: "q-plain", count: 1 }] },
			() => basicAddition({ id: "q-plain", tags: [] }),
			seededRandom(3),
		);
		expect(summariseExam(markExam(untagged.items, [""])).byTag).toEqual([{ label: "Untagged", correct: 0, total: 1 }]);
	});
});

describe("passing grade validation", () => {
	it("defaults new exams to 40% and keeps 50% for older files without a value", () => {
		expect(DEFAULT_PASSING_PERCENT).toBe(40);
		expect(LEGACY_PASSING_PERCENT).toBe(50);
	});

	it.each([0, 1, 50, 100])("accepts %d", (value) => {
		expect(isValidPassingPercent(value)).toBe(true);
		expect(validateExam({ ...exam, passingPercent: value }).some((issue) => issue.path === "passingPercent")).toBe(false);
	});

	it.each([-1, 101, 49.5, Number.NaN])("rejects %d", (value) => {
		expect(isValidPassingPercent(value)).toBe(false);
		expect(validateExam({ ...exam, passingPercent: value }).map((issue) => issue.path)).toContain("passingPercent");
	});
});

describe("time limits", () => {
	it.each([
		["10min", 10],
		["1hr", 60],
		["1hr 30min", 90],
		["2h", 120],
		["45 minutes", 45],
		["90", 90],
		[30, 30],
	])("parses %j", (text, minutes) => {
		expect(parseTimeLimit(text)).toBe(minutes);
	});

	it("treats empty values as untimed and rejects nonsense", () => {
		expect(parseTimeLimit(undefined)).toBeNull();
		expect(parseTimeLimit("none")).toBeNull();
		expect(parseTimeLimit("")).toBeNull();
		expect(parseTimeLimit("soon")).toBeUndefined();
		expect(parseTimeLimit(0)).toBeUndefined();
		expect(parseTimeLimit(-5)).toBeUndefined();
		expect(parseTimeLimit("0min")).toBeUndefined();
	});

	it("formats minutes", () => {
		expect(formatTimeLimit(10)).toBe("10min");
		expect(formatTimeLimit(60)).toBe("1hr");
		expect(formatTimeLimit(90)).toBe("1hr 30min");
	});
});
