import { describe, expect, it } from "vitest";
import type { ExamDefinition } from "../src/core/exam";
import { examRecord, parseExamRecord } from "../src/storage/exam-format";
import { roundTripExam } from "./helpers";

const exam: ExamDefinition = { id: "e-1", title: "Mock", tags: [], timeLimitMinutes: null, passingPercent: 40, questions: [] };

describe("exam formula sheet", () => {
	it("keeps the text exactly, including LaTeX and line breaks", () => {
		const formulaSheet = "$F = ma$\n\n$$\\frac{a}{b}$$\n";
		const result = roundTripExam({ ...exam, formulaSheet });
		expect(result.ok && result.definition.formulaSheet).toBe(formulaSheet);
	});

	it("leaves the field out when there is no text", () => {
		expect(examRecord(exam)).not.toHaveProperty("formulaSheet");
		expect(examRecord({ ...exam, formulaSheet: "  \n" })).not.toHaveProperty("formulaSheet");
		const result = roundTripExam(exam);
		expect(result.ok && "formulaSheet" in result.definition).toBe(false);
	});

	it("ignores blank or non-text values instead of rejecting the exam", () => {
		for (const formulaSheet of ["   ", 42, null]) {
			const result = parseExamRecord("e-1", { formulaSheet });
			expect(result.ok && "formulaSheet" in result.definition).toBe(false);
		}
	});
});
