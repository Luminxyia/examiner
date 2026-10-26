import { describe, expect, it } from "vitest";
import { checkAnswer, formatExpectedAnswer } from "../src/core/answer";
import { blankFlashcard } from "../src/core/definition";
import { markExam, prepareExam, type CalculationItem } from "../src/core/exam";
import { evaluate, parseExpression } from "../src/core/expression";
import { formatScientific, parseNumberInput } from "../src/core/numbers";
import { parseQuestionFile, serializeQuestion } from "../src/storage/question-format";
import { basicAddition, seededRandom } from "./helpers";

describe("scientific notation answers", () => {
	it.each([
		["1.7*10^-6", 1.7e-6],
		["1.7e-6", 1.7e-6],
		["1.7E-6", 1.7e-6],
		["1.7 × 10^-6", 1.7e-6],
		["1.7 x 10^-6", 1.7e-6],
		["1.7X10^-6", 1.7e-6],
		["1.7·10^-6", 1.7e-6],
		["1.7 * 10 ^ -6", 1.7e-6],
		["1.7×10^(−6)", 1.7e-6],
		["−2.5 × 10^3", -2500],
		["3*10^+2", 300],
		["6.022 × 10^23", 6.022e23],
		[".5*10^1", 5],
	])("parses %j", (text, value) => {
		expect(parseNumberInput(text)).toEqual({ ok: true, value });
	});

	it.each(["1.7*10^", "1.7*11^2", "10^-6", "1.7**10^-6", "1.7*10^-6.5", "1.7*10^-6x"])("rejects %j", (text) => {
		expect(parseNumberInput(text).ok).toBe(false);
	});

	it("still accepts ordinary integers and decimals", () => {
		expect(parseNumberInput("42")).toEqual({ ok: true, value: 42 });
		expect(parseNumberInput("0.0000017")).toEqual({ ok: true, value: 0.0000017 });
	});

	it("treats scientific and decimal forms of the same value as equal", () => {
		const parsed = parseNumberInput("1.7 × 10^-6");
		expect(parsed.ok && checkAnswer({ check: "exact" }, 0.0000017, parsed.value).correct).toBe(true);
		const rounded = parseNumberInput("1.27e1");
		expect(rounded.ok && checkAnswer({ check: "rounded", places: 1 }, 12.7349, rounded.value).correct).toBe(true);
		const tolerant = parseNumberInput("1.71*10^-6");
		expect(tolerant.ok && checkAnswer({ check: "relative", percent: 1 }, 1.7e-6, tolerant.value).correct).toBe(true);
	});

	it("accepts scientific notation in formula steps", () => {
		for (const source of ["1.7*10^-6", "1.7 × 10^-6", "1.7e-6", "1.7E-6"]) {
			expect(evaluate(parseExpression(source), new Map())).toBeCloseTo(1.7e-6, 15);
		}
	});
});

describe("scientific notation display", () => {
	it.each([
		[0.0000017, "1.7 × 10^-6"],
		[12.73, "1.273 × 10^1"],
		[-45000, "-4.5 × 10^4"],
		[1, "1 × 10^0"],
		[0, "0"],
	])("formats %d", (value, text) => {
		expect(formatScientific(value)).toBe(text);
	});

	it("only changes how the expected answer is shown", () => {
		expect(formatExpectedAnswer({ check: "rounded", places: 2 }, 1234.5678)).toBe("1234.57");
		expect(formatExpectedAnswer({ check: "rounded", places: 2 }, 1234.5678, true)).toBe("1.23457 × 10^3");
		expect(formatExpectedAnswer({ check: "exact" }, 0.0000017, true)).toBe("1.7 × 10^-6");
	});

	it("is saved with calculation questions and left off older files", () => {
		const question = { ...basicAddition(), scientific: true };
		const content = serializeQuestion(question);
		expect(content).toContain("examiner-scientific-notation: true");
		const parsed = parseQuestionFile(content);
		expect(parsed.ok && parsed.definition.scientific).toBe(true);
		const plain = parseQuestionFile(serializeQuestion(basicAddition()));
		expect(plain.ok && "scientific" in plain.definition).toBe(false);
	});

	it("is dropped from flashcards, which have no numeric answer", () => {
		const card = { ...basicAddition(), kind: "flashcard" as const, flashcard: { ...blankFlashcard(), answer: "A" }, scientific: true };
		expect(serializeQuestion(card)).not.toContain("examiner-scientific-notation");
	});

	it("carries through to exam results", () => {
		const question = basicAddition({ id: "q-sci", scientific: true });
		const { items } = prepareExam(
			{ id: "e", title: "Sci", tags: [], timeLimitMinutes: null, passingPercent: 40, questions: [{ questionId: "q-sci", count: 1 }] },
			() => question,
			seededRandom(1),
		);
		const item = items[0] as CalculationItem;
		expect(item.scientific).toBe(true);
		const [result] = markExam(items, [String(item.instance.answer)]);
		expect(result?.expectedDisplay).toContain("× 10^");
		expect(result?.outcome).toBe("correct");
	});
});
