import { describe, expect, it } from "vitest";
import { attemptText, markExam, type ExamItem } from "../src/core/exam";
import type { UpcomingExam } from "../src/core/exam-prep";
import { ResultsStore } from "../src/storage/results";
import { FakeDataFiles } from "./fake-files";
import { item } from "./helpers";

const calculation: ExamItem = {
	questionId: "q",
	title: "Beam",
	tags: [],
	answerRule: { check: "exact" },
	instance: {
		questionId: "q",
		inputs: { F: 12, d: 3 },
		steps: [{ target: "answer", expression: "{F} * {d}", value: 36 }],
		answer: 36,
		prompt: "A beam carries 12 kN at 3 m",
	},
};

describe("workings on marked questions", () => {
	it("keeps the working without changing the mark", () => {
		const [wrong] = markExam([calculation], ["18"], [], [], [" M = 18 "]);
		const [right] = markExam([calculation], ["36"], [], [], ["anything"]);
		expect(wrong).toMatchObject({ outcome: "incorrect", working: "M = 18" });
		expect(right).toMatchObject({ outcome: "correct", working: "anything" });
	});

	it("leaves the field out when the working is blank", () => {
		const [result] = markExam([calculation], ["36"], [], [], ["   "]);
		expect(result).not.toHaveProperty("working");
	});

	it("keeps the working on a don't know answer", () => {
		const [result] = markExam([calculation], [""], [true], [], ["stuck here"]);
		expect(result).toMatchObject({ outcome: "unknown", working: "stuck here" });
	});
});

describe("copied attempt text", () => {
	it("matches the agreed format", () => {
		const [result] = markExam([calculation], ["18"], [], [], ["M = 12 * 3 / 2\nM = 18"]);
		expect(attemptText(result)).toBe(
			[
				"Question: A beam carries 12 kN at 3 m",
				"My answer: 18 (incorrect), expected 36",
				"My working:",
				"M = 12 * 3 / 2",
				"M = 18",
				"Correct steps:",
				"{answer} = {F} * {d} = 12 * 3 = 36",
			].join("\n"),
		);
	});

	it("leaves out empty sections", () => {
		expect(attemptText({ ...item("card", "correct"), expectedDisplay: "Ohm's law", response: "Ohm's law" })).toBe(
			"Question: Prompt for card\nMy answer: Ohm's law (correct), expected Ohm's law",
		);
	});

	it("describes unanswered and don't know answers", () => {
		expect(attemptText(item("a", "unanswered"))).toContain("My answer: No answer, expected 1");
		expect(attemptText(item("a", "unknown"))).toContain("My answer: I don't know, expected 1");
	});
});

describe("upcoming exam storage", () => {
	const exam: UpcomingExam = { id: "u-1", title: "Final", date: "2027-01-14", targetPercent: 75, questionIds: ["a"], examIds: ["e"] };

	it("saves, updates and deletes", async () => {
		const store = new ResultsStore(new FakeDataFiles(), "data");
		expect(await store.readUpcomingExams()).toEqual([]);
		await store.saveUpcomingExam(exam);
		await store.saveUpcomingExam({ ...exam, title: "Renamed" });
		expect(await store.readUpcomingExams()).toEqual([{ ...exam, title: "Renamed" }]);
		await store.deleteUpcomingExam(exam.id);
		expect(await store.readUpcomingExams()).toEqual([]);
	});

	it("is removed by reset", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "data");
		await store.saveUpcomingExam(exam);
		await store.clearAll();
		expect(files.files.size).toBe(0);
	});

	it("refuses to treat a damaged file as empty", async () => {
		const files = new FakeDataFiles();
		files.files.set("data/upcoming-exams.json", "{not json");
		const store = new ResultsStore(files, "data");
		await expect(store.readUpcomingExams()).rejects.toThrow();
	});
});
