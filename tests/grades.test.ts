import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BOUNDARIES, gradeBoundaryIssue, gradeLines, letterGrade } from "../src/core/grades";

describe("letter grades", () => {
	it.each([
		[100, "A+"],
		[90, "A+"],
		[89.9, "A"],
		[70, "A"],
		[69, "B"],
		[60, "B"],
		[59, "C"],
		[50, "C"],
		[49, "D"],
		[40, "D"],
		[39.9, "F"],
		[0, "F"],
	])("gives %d%% a %s", (percent, letter) => {
		expect(letterGrade(percent, DEFAULT_GRADE_BOUNDARIES)).toBe(letter);
	});

	it("follows custom boundaries", () => {
		const boundaries = { aPlus: 95, a: 85, b: 75, c: 65, d: 55 };
		expect(letterGrade(80, boundaries)).toBe("B");
		expect(letterGrade(54, boundaries)).toBe("F");
	});

	it("lists a line for each letter above F, highest first", () => {
		expect(gradeLines(DEFAULT_GRADE_BOUNDARIES)).toEqual([
			{ letter: "A+", percent: 90 },
			{ letter: "A", percent: 70 },
			{ letter: "B", percent: 60 },
			{ letter: "C", percent: 50 },
			{ letter: "D", percent: 40 },
		]);
	});
});

describe("grade boundary validation", () => {
	it("accepts the defaults", () => {
		expect(gradeBoundaryIssue(DEFAULT_GRADE_BOUNDARIES)).toBeNull();
	});

	it.each([0, 101, 45.5, Number.NaN])("rejects a D of %d", (value) => {
		expect(gradeBoundaryIssue({ ...DEFAULT_GRADE_BOUNDARIES, d: value })).toBe("D must be a whole number from 1 to 100.");
	});

	it("rejects a letter that is not lower than the one above it", () => {
		expect(gradeBoundaryIssue({ ...DEFAULT_GRADE_BOUNDARIES, b: 70 })).toBe("B must be lower than A.");
		expect(gradeBoundaryIssue({ ...DEFAULT_GRADE_BOUNDARIES, c: 65 })).toBe("C must be lower than B.");
	});
});
