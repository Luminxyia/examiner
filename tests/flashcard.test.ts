import { describe, expect, it } from "vitest";
import { validateDefinition, type QuestionDefinition } from "../src/core/definition";
import {
	markExam,
	MarkingIncompleteError,
	pendingMarking,
	prepareExam,
	summariseExam,
	type CalculationItem,
	type ExamDefinition,
	type ExamItem,
	type FlashcardItem,
} from "../src/core/exam";
import { awardedMarks, chosenOption, drawFlashcard, expectedFlashcardAnswer } from "../src/core/flashcard";
import { EXAMPLE_QUESTION, EXAMPLE_TAG, withoutDefaultTags } from "../src/example";
import { basicAddition, seededRandom } from "./helpers";

const written = (overrides: Partial<QuestionDefinition> = {}): QuestionDefinition => ({
	...basicAddition({ id: "q-written", title: "Resonance", tags: ["physics"] }),
	kind: "flashcard",
	prompt: "What is resonant frequency?",
	variables: [],
	steps: [],
	flashcard: { mode: "written", answer: "The frequency of maximum amplitude.", options: [], correct: 0 },
	marks: 5,
	...overrides,
});

const choice = (overrides: Partial<QuestionDefinition> = {}): QuestionDefinition => ({
	...written({ id: "q-choice", title: "Units", tags: ["physics"] }),
	flashcard: { mode: "choice", answer: "", options: ["Ohm", "Farad", "Henry", "Tesla"], correct: 1 },
	marks: 2,
	...overrides,
});

const paths = (definition: QuestionDefinition) => validateDefinition(definition).filter((issue) => issue.severity === "error").map((issue) => issue.path);

describe("flashcard validation", () => {
	it("accepts complete written and multiple-choice flashcards without calculation fields", () => {
		expect(paths(written())).toEqual([]);
		expect(paths(choice())).toEqual([]);
	});

	it("requires the question and the expected answer for written flashcards", () => {
		expect(paths(written({ prompt: " ", flashcard: { mode: "written", answer: "", options: [], correct: 0 } }))).toEqual([
			"prompt",
			"flashcard.answer",
		]);
	});

	it("requires at least two filled options and a correct option for multiple choice", () => {
		expect(paths(choice({ flashcard: { mode: "choice", answer: "", options: ["Only"], correct: 0 } }))).toContain("flashcard.options");
		expect(paths(choice({ flashcard: { mode: "choice", answer: "", options: ["A", ""], correct: 0 } }))).toEqual(["flashcard.options.1"]);
		expect(paths(choice({ flashcard: { mode: "choice", answer: "", options: ["A", "B"], correct: -1 } }))).toEqual(["flashcard.options"]);
	});

	it("ignores the expected answer text in multiple-choice mode", () => {
		expect(paths(choice({ flashcard: { mode: "choice", answer: "", options: ["A", "B"], correct: 0 } }))).toEqual([]);
	});

	it.each([0, -1, 2.5, Number.NaN, 1001])("rejects %d marks", (marks) => {
		expect(paths(written({ marks }))).toEqual(["marks"]);
		expect(paths(basicAddition({ marks }))).toEqual(["marks"]);
	});

	it.each([1, 5, 10, 1000])("accepts %d marks", (marks) => {
		expect(paths(written({ marks }))).toEqual([]);
	});

	it("still validates calculation questions as before", () => {
		expect(paths(basicAddition())).toEqual([]);
		expect(paths(basicAddition({ steps: [] }))).toEqual(["steps"]);
	});
});

describe("drawing flashcards", () => {
	it("shuffles multiple-choice options and keeps track of the correct one", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const card = drawFlashcard(choice(), seededRandom(seed));
			expect([...card.options].sort()).toEqual(["Farad", "Henry", "Ohm", "Tesla"]);
			expect(card.options[card.correct]).toBe("Farad");
			expect(expectedFlashcardAnswer(card)).toBe("Farad");
		}
	});

	it("keeps written flashcards as they are", () => {
		const card = drawFlashcard(written());
		expect(card).toMatchObject({ mode: "written", answer: "The frequency of maximum amplitude.", options: [] });
		expect(expectedFlashcardAnswer(card)).toBe("The frequency of maximum amplitude.");
	});

	it("reads chosen options defensively", () => {
		expect(chosenOption("2", 4)).toBe(2);
		expect(chosenOption("4", 4)).toBeNull();
		expect(chosenOption("", 4)).toBeNull();
		expect(chosenOption("-1", 4)).toBeNull();
		expect(chosenOption(undefined, 4)).toBeNull();
	});

	it("awards full, half or no marks, including half marks for odd values", () => {
		expect(awardedMarks("correct", 5)).toBe(5);
		expect(awardedMarks("partial", 5)).toBe(2.5);
		expect(awardedMarks("partial", 4)).toBe(2);
		expect(awardedMarks("incorrect", 5)).toBe(0);
	});
});

describe("mixed exams", () => {
	const library = new Map<string, QuestionDefinition>([
		["q-calc", basicAddition({ id: "q-calc", marks: 10, tags: ["maths"] })],
		["q-written", written()],
		["q-choice", choice()],
	]);
	const exam: ExamDefinition = {
		id: "e-mixed",
		title: "Mixed",
		tags: [],
		timeLimitMinutes: null,
		passingPercent: 40,
		questions: [
			{ questionId: "q-calc", count: 1 },
			{ questionId: "q-written", count: 2 },
			{ questionId: "q-choice", count: 1 },
		],
	};
	const { items } = prepareExam(exam, (id) => library.get(id), seededRandom(7));
	const [calc, firstWritten, , card] = items as [CalculationItem, FlashcardItem, FlashcardItem, FlashcardItem];
	const calcAnswer = String(calc.instance.answer);
	const rightChoice = String(card.correct);
	const wrongChoice = String((card.correct + 1) % card.options.length);

	it("prepares flashcards with their marks and keeps calculation questions unchanged", () => {
		expect(items.map((item) => [item.kind ?? "calculation", item.marks])).toEqual([
			["calculation", 10],
			["flashcard", 5],
			["flashcard", 5],
			["flashcard", 2],
		]);
		expect(firstWritten).toMatchObject({ mode: "written", prompt: "What is resonant frequency?" });
	});

	it("only asks for manual marking of submitted written answers", () => {
		expect(pendingMarking(items, [calcAnswer, "My answer", "Another", rightChoice])).toEqual([1, 2]);
		expect(pendingMarking(items, [calcAnswer, "  ", "Another", rightChoice])).toEqual([2]);
		expect(pendingMarking(items, [calcAnswer, "Typed first", "", rightChoice], [false, true, false, false])).toEqual([]);
	});

	it("skips manual marking when an exam has no written flashcards", () => {
		const autoOnly = items.filter((item) => item.kind !== "flashcard" || item.mode === "choice");
		expect(pendingMarking(autoOnly, [calcAnswer, rightChoice])).toEqual([]);
		expect(() => markExam(autoOnly, [calcAnswer, rightChoice])).not.toThrow();
	});

	it("refuses to finish until every submitted written answer is marked", () => {
		const responses = [calcAnswer, "My answer", "Another", rightChoice];
		expect(() => markExam(items, responses)).toThrow(MarkingIncompleteError);
		expect(() => markExam(items, responses, [], [null, "correct", null, null])).toThrow("1 written answer still needs marking.");
	});

	it("weights every question by its marks", () => {
		const results = markExam(items, [calcAnswer, "My answer", "Another", rightChoice], [], [null, "correct", "partial", null]);
		expect(results.map((result) => [result.outcome, result.awarded, result.marks])).toEqual([
			["correct", 10, 10],
			["correct", 5, 5],
			["partial", 2.5, 5],
			["correct", 2, 2],
		]);
		const summary = summariseExam(results);
		expect(summary).toMatchObject({ total: 4, correct: 3, partial: 1, incorrect: 0, marks: 19.5, maxMarks: 22 });
		expect(summary.percent).toBeCloseTo((19.5 / 22) * 100, 10);
	});

	it("gives unanswered and wrong answers no marks without treating them as correct", () => {
		const results = markExam(items, ["", "", "Wrong idea", wrongChoice], [false, false, false, false], [null, null, "incorrect", null]);
		expect(results.map((result) => [result.outcome, result.awarded])).toEqual([
			["unanswered", 0],
			["unanswered", 0],
			["incorrect", 0],
			["incorrect", 0],
		]);
		expect(summariseExam(results)).toMatchObject({ marks: 0, maxMarks: 22, percent: 0 });
	});

	it("ignores stray judgements on answers that did not need marking", () => {
		const results = markExam(items, [calcAnswer, "", "", rightChoice], [], ["incorrect", "correct", "correct", "incorrect"]);
		expect(results.map((result) => result.awarded)).toEqual([10, 0, 0, 2]);
	});

	it("records the chosen option text and the expected answer for review", () => {
		const [, , , result] = markExam(items, [calcAnswer, "", "", wrongChoice]);
		expect(result).toMatchObject({ kind: "flashcard", response: card.options[Number(wrongChoice)], expectedDisplay: "Farad" });
	});

	it("weights tag and question breakdowns by marks", () => {
		const summary = summariseExam(markExam(items, [calcAnswer, "A", "B", wrongChoice], [], [null, "partial", "incorrect", null]));
		expect(summary.byTag).toEqual([
			{ label: "maths", correct: 10, total: 10 },
			{ label: "physics", correct: 2.5, total: 12 },
		]);
		expect(summary.byQuestion).toEqual([
			{ label: "Basic addition", correct: 10, total: 10 },
			{ label: "Resonance", correct: 2.5, total: 10 },
			{ label: "Units", correct: 0, total: 2 },
		]);
	});

	it("never counts a question twice", () => {
		const results = markExam(items, [calcAnswer, "A", "B", rightChoice], [], [null, "correct", "correct", null]);
		expect(results).toHaveLength(items.length);
		expect(summariseExam(results)).toMatchObject({ marks: 22, maxMarks: 22, percent: 100 });
	});
});

describe("items saved before marks existed", () => {
	it("treats them as worth 1 mark each", () => {
		const legacy = prepareExam(
			{ id: "e", title: "Old", tags: [], timeLimitMinutes: null, passingPercent: 50, questions: [{ questionId: "q", count: 2 }] },
			() => basicAddition({ id: "q" }),
			seededRandom(1),
		).items.map(({ marks: _marks, ...item }) => item as ExamItem);
		const answer = String((legacy[0] as CalculationItem).instance.answer);
		const summary = summariseExam(markExam(legacy, [answer, ""]));
		expect(summary).toMatchObject({ marks: 1, maxMarks: 2, percent: 50 });
	});
});

describe("default tags", () => {
	it("removes only the sample question's tag", () => {
		expect(EXAMPLE_QUESTION.tags).toEqual([EXAMPLE_TAG]);
		expect(withoutDefaultTags(EXAMPLE_QUESTION.tags)).toEqual([]);
		expect(withoutDefaultTags(["physics", "Examiner-Example", "physics/waves"])).toEqual(["physics", "physics/waves"]);
		expect(withoutDefaultTags([])).toEqual([]);
	});
});
