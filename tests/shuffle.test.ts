import { describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../src/core/definition";
import { markExam, prepareExam, summariseExam, type CalculationItem, type ExamDefinition } from "../src/core/exam";
import { shuffled } from "../src/core/random";
import { parseExamFile, serializeExam } from "../src/storage/exam-format";
import { basicAddition, seededRandom } from "./helpers";

const library = new Map<string, QuestionDefinition>(
	["a", "b", "c", "d", "e"].map((id) => [`q-${id}`, basicAddition({ id: `q-${id}`, title: `Question ${id.toUpperCase()}` })]),
);

const exam: ExamDefinition = {
	id: "e-order",
	title: "Ordered",
	tags: [],
	timeLimitMinutes: null,
	passingPercent: 40,
	questions: [
		{ questionId: "q-a", count: 2 },
		{ questionId: "q-b", count: 1 },
		{ questionId: "q-c", count: 1 },
		{ questionId: "q-d", count: 1 },
		{ questionId: "q-e", count: 1 },
	],
};

const order = (shuffle: boolean, seed: number) =>
	prepareExam({ ...exam, shuffle }, (id) => library.get(id), seededRandom(seed)).items.map((item) => item.questionId);

describe("randomised question order", () => {
	it("keeps the configured order when the option is off or missing", () => {
		const configured = ["q-a", "q-a", "q-b", "q-c", "q-d", "q-e"];
		expect(order(false, 1)).toEqual(configured);
		expect(prepareExam(exam, (id) => library.get(id), seededRandom(1)).items.map((item) => item.questionId)).toEqual(configured);
	});

	it("shuffles every item, including repeated copies, without losing or adding any", () => {
		const shuffledOrder = order(true, 3);
		expect([...shuffledOrder].sort()).toEqual(["q-a", "q-a", "q-b", "q-c", "q-d", "q-e"]);
		const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
		expect(seeds.some((seed) => order(true, seed).join() !== order(false, seed).join())).toBe(true);
	});

	it("leaves the exam's own question list untouched", () => {
		const copy = structuredClone(exam);
		prepareExam({ ...copy, shuffle: true }, (id) => library.get(id), seededRandom(4));
		expect(copy.questions).toEqual(exam.questions);
	});

	it("keeps answers, marking and results tied to the right questions", () => {
		const { items } = prepareExam({ ...exam, shuffle: true }, (id) => library.get(id), seededRandom(5));
		const calculations = items as CalculationItem[];
		const responses = calculations.map((item, index) => (index % 2 === 0 ? String(item.instance.answer) : "-1"));
		const results = markExam(items, responses);
		results.forEach((result, index) => {
			expect(result.questionId).toBe(items[index]?.questionId);
			expect(result.prompt).toBe(calculations[index]?.instance.prompt);
			expect(result.outcome).toBe(index % 2 === 0 ? "correct" : "incorrect");
		});
		expect(summariseExam(results)).toMatchObject({ total: 6, correct: 3, incorrect: 3 });
	});

	it("does not modify the list it shuffles", () => {
		const input = [1, 2, 3, 4];
		shuffled(input, seededRandom(1));
		expect(input).toEqual([1, 2, 3, 4]);
	});
});

describe("randomised order in exam files", () => {
	it("saves the option and restores it when the exam is reopened", () => {
		const content = serializeExam({ ...exam, shuffle: true });
		expect(content).toContain("examiner-randomize-order: true");
		const result = parseExamFile(content);
		expect(result.ok && result.definition.shuffle).toBe(true);
	});

	it("leaves exams without the option as they were", () => {
		const content = serializeExam(exam);
		expect(content).not.toContain("examiner-randomize-order");
		const result = parseExamFile(content);
		expect(result.ok && "shuffle" in result.definition).toBe(false);
	});
});
