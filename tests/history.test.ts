import { describe, expect, it } from "vitest";
import { describeChange, filterExamGroups, formatSignedPercent,
 groupAttemptsByExam, relativeChange, scoreTrend, type AttemptSummary } from "../src/core/statistics";

const attempt = (id: string, examId: string, day: number, percent: number, maxMarks = 10, title = examId): AttemptSummary => ({
	id,
	examId,
	examTitle: title,
	submittedAt: new Date(Date.UTC(2026, 9, day, 12)).toISOString(),
	correct: Math.round((percent / 100) * maxMarks),
	total: maxMarks,
	marks: (percent / 100) * maxMarks,
	maxMarks,
	percent,
});

const attempts = [
	attempt("m1", "maths", 1, 60, 10, "Maths"),
	attempt("e1", "elec", 3, 67, 10, "Electronics"),
	attempt("m2", "maths", 5, 65, 10, "Maths"),
	attempt("m3", "maths", 9, 40, 10, "Mathematics I"),
	attempt("p1", "phys", 7, 75, 10, "Physics"),
	attempt("p2", "phys", 8, 85, 10, "Physics"),
];

describe("grouped exam history", () => {
	const groups = groupAttemptsByExam(attempts);

	it("shows each exam once with its attempts newest first", () => {
		expect(groups.map((group) => group.examId)).toEqual(["maths", "phys", "elec"]);
		const maths = groups[0];
		expect(maths?.attempts.map((entry) => [entry.id, entry.attemptNumber])).toEqual([
			["m3", 3],
			["m2", 2],
			["m1", 1],
		]);
		expect(groups.flatMap((group) => group.attempts)).toHaveLength(attempts.length);
	});

	it("uses the latest recorded title, or the current title when the exam still exists", () => {
		expect(groups[0]?.title).toBe("Mathematics I");
		const renamed = groupAttemptsByExam(attempts, (id) => (id === "phys" ? "Physics I" : undefined));
		expect(renamed.find((group) => group.examId === "phys")?.title).toBe("Physics I");
		expect(renamed.find((group) => group.examId === "elec")?.title).toBe("Electronics");
	});

	it("reports trends as a percentage of the previous score, only when a comparable previous attempt exists", () => {
		const byId = new Map(groups.map((group) => [group.examId, group]));
		expect(byId.get("maths")?.trend).toEqual({ kind: "change", points: -25, relative: -38 });
		expect(byId.get("phys")?.trend).toEqual({ kind: "change", points: 10, relative: 13 });
		expect(byId.get("elec")?.trend).toEqual({ kind: "none", reason: "single-attempt" });
	});

	it("does not compare attempts whose maximum marks differ", () => {
		expect(scoreTrend(attempt("b", "x", 2, 80, 20), attempt("a", "x", 1, 50, 10))).toEqual({ kind: "none", reason: "not-comparable" });
	});
});

describe("relative score changes", () => {
	it("uses the previous score as the baseline", () => {
		expect(relativeChange(60, 75)).toBe(-20);
		expect(relativeChange(60, 50)).toBe(20);
		expect(relativeChange(50, 50)).toBe(0);
	});

	it("signs increases with + and decreases with -", () => {
		expect(formatSignedPercent(20)).toBe("+20%");
		expect(formatSignedPercent(-20)).toBe("-20%");
		expect(formatSignedPercent(0)).toBe("0%");
	});

	it("rounds to whole percentages", () => {
		expect(relativeChange(40, 65)).toBe(-38);
		expect(relativeChange(70, 60)).toBe(17);
	});

	it("does not divide by a previous score of 0%", () => {
		expect(relativeChange(50, 0)).toBeNull();
		expect(relativeChange(0, 0)).toBeNull();
		const trend = scoreTrend(attempt("b", "x", 2, 50), attempt("a", "x", 1, 0));
		expect(trend).toEqual({ kind: "change", points: 50, relative: null });
		if (trend.kind === "change") expect(describeChange(trend, "rose", "fell")).toBe("rose from 0%");
	});

	it("describes increases and decreases", () => {
		const down = scoreTrend(attempt("b", "x", 2, 60), attempt("a", "x", 1, 75));
		const up = scoreTrend(attempt("b", "x", 2, 60), attempt("a", "x", 1, 50));
		if (down.kind === "change") expect(describeChange(down, "increased", "decreased")).toBe("decreased (-20%)");
		if (up.kind === "change") expect(describeChange(up, "increased", "decreased")).toBe("increased (+20%)");
		expect(down.kind).toBe("change");
		expect(up.kind).toBe("change");
	});
});

describe("history filters", () => {
	const groups = groupAttemptsByExam(attempts);

	it("lists all exams alphabetically", () => {
		expect(filterExamGroups(groups, "all").map((group) => group.title)).toEqual(["Electronics", "Mathematics I", "Physics"]);
	});

	it("puts the lowest latest scores first", () => {
		expect(filterExamGroups(groups, "lowest").map((group) => group.examId)).toEqual(["maths", "elec", "phys"]);
	});

	it("puts the most recently attempted exams first", () => {
		expect(filterExamGroups(groups, "recent").map((group) => group.examId)).toEqual(["maths", "phys", "elec"]);
	});

	it("never duplicates or drops groups and copes with no history", () => {
		for (const filter of ["all", "lowest", "recent"] as const) expect(filterExamGroups(groups, filter)).toHaveLength(3);
		expect(groupAttemptsByExam([])).toEqual([]);
		expect(filterExamGroups([], "lowest")).toEqual([]);
	});
});
