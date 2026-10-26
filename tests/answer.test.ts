import { describe, expect, it } from "vitest";
import { answerInstruction, checkAnswer, expectedAnswer, formatExpectedAnswer } from "../src/core/answer";
import { formatFixed, formatNumber, hasAtMostPlaces, parseNumberInput, roundToPlaces } from "../src/core/numbers";

describe("roundToPlaces", () => {
	it("rounds half away from zero", () => {
		expect(roundToPlaces(2.5, 0)).toBe(3);
		expect(roundToPlaces(-2.5, 0)).toBe(-3);
		expect(roundToPlaces(1.25, 1)).toBe(1.3);
		expect(roundToPlaces(-1.25, 1)).toBe(-1.3);
	});

	it("is not fooled by binary representation", () => {
		expect(roundToPlaces(1.005, 2)).toBe(1.01);
		expect(roundToPlaces(1.255, 2)).toBe(1.26);
		expect(roundToPlaces(0.1 + 0.2, 2)).toBe(0.3);
		expect(roundToPlaces(8.345, 2)).toBe(8.35);
	});

	it("handles very large and very small values", () => {
		expect(roundToPlaces(1e21, 2)).toBe(1e21);
		expect(roundToPlaces(1.23456e-7, 3)).toBe(0);
		expect(roundToPlaces(-0.0001, 2)).toBe(0);
		expect(Object.is(roundToPlaces(-0.0001, 2), -0)).toBe(false);
	});

	it("counts decimal places", () => {
		expect(hasAtMostPlaces(1.25, 2)).toBe(true);
		expect(hasAtMostPlaces(1.255, 2)).toBe(false);
		expect(hasAtMostPlaces(0.1 + 0.2, 1)).toBe(true);
	});
});

describe("formatting", () => {
	it("hides floating-point noise in calculated values", () => {
		expect(formatNumber(0.1 + 0.2)).toBe("0.3");
		expect(formatNumber(12.727922061357855)).toBe("12.72792206");
		expect(formatNumber(19)).toBe("19");
		expect(formatNumber(-0)).toBe("0");
		expect(formatNumber(1.5e21)).toBe("1.5e21");
	});

	it("pads fixed places", () => {
		expect(formatFixed(19, 2)).toBe("19.00");
		expect(formatFixed(1.005, 2)).toBe("1.01");
		expect(formatFixed(-0.001, 2)).toBe("0.00");
	});
});

describe("parseNumberInput", () => {
	it.each([
		["5", 5],
		["5.0", 5],
		["5.00", 5],
		[" -3.5 ", -3.5],
		["+2", 2],
		[".5", 0.5],
		["5.", 5],
		["1e3", 1000],
		["1.2E-2", 0.012],
		["−4", -4],
	])("parses %j", (text, value) => {
		expect(parseNumberInput(text)).toEqual({ ok: true, value });
	});

	it.each([
		["", "Enter a number"],
		["   ", "Enter a number"],
		["5abc", "is not a number"],
		["abc", "is not a number"],
		["1/2", "is not a number"],
		["3,5", "full stop"],
		["1,000", "full stop"],
		["--5", "is not a number"],
		["Infinity", "is not a number"],
		["1e999", "too large"],
	])("rejects %j", (text, message) => {
		const result = parseNumberInput(text);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain(message);
	});
});

describe("exact check", () => {
	const rule = { check: "exact" } as const;

	it("treats 5, 5.0 and 5.00 as equal", () => {
		for (const text of ["5", "5.0", "5.00"]) {
			const parsed = parseNumberInput(text);
			expect(parsed.ok && checkAnswer(rule, 5, parsed.value).correct).toBe(true);
		}
	});

	it("absorbs floating-point noise only", () => {
		expect(checkAnswer(rule, 0.1 + 0.2, 0.3).correct).toBe(true);
		expect(checkAnswer(rule, 19, 19.001).correct).toBe(false);
		expect(checkAnswer(rule, 0, 1e-12).correct).toBe(true);
		expect(checkAnswer(rule, 0, 1e-6).correct).toBe(false);
	});

	it("shows no instruction", () => {
		expect(answerInstruction(rule)).toBeNull();
		expect(formatExpectedAnswer(rule, 0.1 + 0.2)).toBe("0.3");
	});
});

describe("rounded check", () => {
	const rule = { check: "rounded", places: 2 } as const;
	const answer = 12.727922061357855;

	it("rounds the expected answer consistently with the instruction", () => {
		expect(answerInstruction(rule)).toBe("Round your answer to 2 decimal places.");
		expect(expectedAnswer(rule, answer)).toBe(12.73);
		expect(formatExpectedAnswer(rule, answer)).toBe("12.73");
	});

	it("accepts the rounded value in any equivalent form", () => {
		expect(checkAnswer(rule, answer, 12.73).correct).toBe(true);
		expect(checkAnswer(rule, answer, Number("12.730")).correct).toBe(true);
	});

	it("rejects unrounded or wrongly rounded values", () => {
		const unrounded = checkAnswer(rule, answer, 12.7279);
		expect(unrounded.correct).toBe(false);
		expect(unrounded.hint).toContain("needs rounding");
		expect(checkAnswer(rule, answer, 12.72).correct).toBe(false);
		expect(checkAnswer(rule, answer, 12.7).correct).toBe(false);
	});

	it("rounds halves away from zero", () => {
		expect(checkAnswer(rule, 1.005, 1.01).correct).toBe(true);
		expect(checkAnswer(rule, -1.005, -1.01).correct).toBe(true);
	});

	it("phrases whole-number and single-place instructions", () => {
		expect(answerInstruction({ check: "rounded", places: 0 })).toBe("Round your answer to the nearest whole number.");
		expect(answerInstruction({ check: "rounded", places: 1 })).toBe("Round your answer to 1 decimal place.");
		expect(formatExpectedAnswer({ check: "rounded", places: 0 }, 19)).toBe("19");
	});
});

describe("tolerance checks", () => {
	it("accepts values within an absolute tolerance, including the boundary", () => {
		const rule = { check: "absolute", tolerance: 0.1 } as const;
		expect(checkAnswer(rule, 10, 9.9).correct).toBe(true);
		expect(checkAnswer(rule, 10, 10.1).correct).toBe(true);
		expect(checkAnswer(rule, 10, 10.11).correct).toBe(false);
	});

	it("accepts values within a relative tolerance", () => {
		const rule = { check: "relative", percent: 1 } as const;
		expect(checkAnswer(rule, 200, 202).correct).toBe(true);
		expect(checkAnswer(rule, 200, 197.9).correct).toBe(false);
		expect(checkAnswer(rule, -200, -198).correct).toBe(true);
	});

	it("falls back to an exact comparison for a relative tolerance on zero", () => {
		const rule = { check: "relative", percent: 5 } as const;
		expect(checkAnswer(rule, 0, 0).correct).toBe(true);
		expect(checkAnswer(rule, 0, 0.001).correct).toBe(false);
	});
});
