import { describe, expect, it } from "vitest";
import { blankFlashcard, type QuestionDefinition } from "../src/core/definition";
import { markExam, prepareExam, type CalculationItem } from "../src/core/exam";
import { parseQuestionRecord, questionRecord } from "../src/storage/question-format";
import { basicAddition, roundTripExam, roundTripQuestion, seededRandom } from "./helpers";

describe("question images in records", () => {
	it("saves image names and restores them when the question is reopened", () => {
		const question = basicAddition({ id: "q-img", images: ["circuit.png", "graph (2).jpg"] });
		expect(questionRecord(question).images).toEqual(question.images);
		const result = roundTripQuestion(question);
		expect(result.ok && result.definition.images).toEqual(["circuit.png", "graph (2).jpg"]);
	});

	it("keeps images on flashcards too", () => {
		const card: QuestionDefinition = { ...basicAddition({ id: "q-card" }), kind: "flashcard", flashcard: { ...blankFlashcard(), answer: "A" }, images: ["diagram.webp"] };
		const result = roundTripQuestion(card);
		expect(result.ok && result.definition.images).toEqual(["diagram.webp"]);
	});

	it("leaves questions without images unchanged", () => {
		expect(questionRecord(basicAddition())).not.toHaveProperty("images");
		const result = roundTripQuestion(basicAddition());
		expect(result.ok && "images" in result.definition).toBe(false);
	});

	it("skips names that are unsafe or not images instead of rejecting the question", () => {
		const result = parseQuestionRecord("q", { images: ["ok.png", "sheet.pdf", "../escape.png", "ok.png"], prompt: "Prompt" });
		expect(result.ok && result.definition.images).toEqual(["ok.png"]);
	});

	it("still reads exam attachments with the shared reader", () => {
		const exam = { id: "e", title: "E", tags: [], timeLimitMinutes: null, passingPercent: 40, questions: [], attachments: ["sheet.pdf", "chart.png"] };
		const result = roundTripExam(exam);
		expect(result.ok && result.definition.attachments).toEqual(["sheet.pdf", "chart.png"]);
	});
});

describe("question images in exams", () => {
	const question = basicAddition({ id: "q-img", images: ["circuit.png"] });
	const plain = basicAddition({ id: "q-plain" });
	const library = new Map([question, plain].map((entry) => [entry.id, entry]));
	const { items } = prepareExam(
		{
			id: "e",
			title: "E",
			tags: [],
			timeLimitMinutes: null,
			passingPercent: 40,
			questions: [
				{ questionId: "q-img", count: 2 },
				{ questionId: "q-plain", count: 1 },
			],
		},
		(id) => library.get(id),
		seededRandom(1),
	);

	it("records each question's images when the exam starts", () => {
		expect(items.map((item) => item.images)).toEqual([["circuit.png"], ["circuit.png"], undefined]);
	});

	it("keeps the snapshot even if the question changes later", () => {
		question.images?.push("added-later.png");
		expect(items[0]?.images).toEqual(["circuit.png"]);
		question.images?.pop();
	});

	it("carries images into the results for review", () => {
		const responses = (items as CalculationItem[]).map((item) => String(item.instance.answer));
		const results = markExam(items, responses);
		expect(results.map((result) => result.images)).toEqual([["circuit.png"], ["circuit.png"], undefined]);
	});
});
