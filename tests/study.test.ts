import { beforeEach, describe, expect, it } from "vitest";
import {
	attemptedExams,
	compareWithYesterday,
	dailyStudyTotals,
	examHistory,
	formatDuration,
	numberAttempts,
	summariseStudy,
	type AttemptSummary,
} from "../src/core/statistics";
import { IDLE_LIMIT_MS, MIN_SESSION_MS, StudyTracker, type StudyContext, type StudySessionRecord } from "../src/core/study-time";

const MINUTE = 60_000;

describe("StudyTracker", () => {
	let clock: number;
	let recorded: StudySessionRecord[];
	let tracker: StudyTracker;
	let nextId: number;

	const practice: StudyContext = { kind: "practice", key: "practice:q-1", questionId: "q-1" };
	const exam: StudyContext = { kind: "exam", key: "exam:r-1", examId: "e-1", attemptId: "r-1" };
	const advance = (ms: number) => {
		clock += ms;
	};

	beforeEach(() => {
		clock = Date.UTC(2026, 9, 25, 9, 0, 0);
		recorded = [];
		nextId = 0;
		tracker = new StudyTracker(() => clock, () => `s-${++nextId}`, (record) => recorded.push(record));
	});

	it("counts focused time with a study context and records it when the context ends", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(2 * MINUTE);
		tracker.activity();
		advance(MINUTE);
		tracker.setContext(null);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({ kind: "practice", questionId: "q-1", activeMs: 3 * MINUTE });
		expect(Date.parse(recorded[0].endedAt) - Date.parse(recorded[0].startedAt)).toBe(3 * MINUTE);
	});

	it("does not count without a context, such as while browsing the exam list", () => {
		tracker.setEngaged(true);
		advance(10 * MINUTE);
		tracker.activity();
		tracker.finish();
		expect(recorded).toEqual([]);
	});

	it("does not count while the window is unfocused or hidden", () => {
		tracker.setContext(practice);
		tracker.setEngaged(true);
		advance(MINUTE);
		tracker.setEngaged(false);
		advance(30 * MINUTE);
		tracker.setEngaged(true);
		advance(MINUTE);
		tracker.finish();
		expect(recorded[0]?.activeMs).toBe(2 * MINUTE);
	});

	it("caps inactivity at the idle limit", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(60 * MINUTE);
		tracker.finish();
		expect(recorded[0]?.activeMs).toBe(IDLE_LIMIT_MS);
	});

	it("stops at the idle limit and resumes on the next input, as after a suspended laptop", () => {
		tracker.setEngaged(true);
		tracker.setContext(exam);
		advance(MINUTE);
		tracker.activity();
		advance(3 * 60 * MINUTE);
		tracker.activity();
		advance(2 * MINUTE);
		tracker.finish();
		expect(recorded[0]?.activeMs).toBe(MINUTE + IDLE_LIMIT_MS + 2 * MINUTE);
	});

	it("reporting the same context again, as when a view re-renders, does not split or double count", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(MINUTE);
		tracker.setContext({ ...practice });
		tracker.setContext({ ...practice });
		advance(MINUTE);
		tracker.finish();
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.activeMs).toBe(2 * MINUTE);
	});

	it("switching between practice and an exam records two separate sessions", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(MINUTE);
		tracker.setContext(exam);
		advance(2 * MINUTE);
		tracker.setContext(null);
		expect(recorded.map((record) => [record.kind, record.activeMs])).toEqual([
			["practice", MINUTE],
			["exam", 2 * MINUTE],
		]);
		expect(recorded[1]).toMatchObject({ examId: "e-1", attemptId: "r-1" });
	});

	it("ignores very short sessions", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(MIN_SESSION_MS - 1);
		tracker.finish();
		expect(recorded).toEqual([]);
	});

	it("never produces negative time when the clock moves backwards", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(MINUTE);
		advance(-10 * MINUTE);
		tracker.activity();
		advance(MINUTE);
		tracker.finish();
		expect(recorded.every((record) => record.activeMs >= 0)).toBe(true);
		expect(tracker.currentActiveMs()).toBe(0);
	});

	it("finishing twice records once", () => {
		tracker.setEngaged(true);
		tracker.setContext(practice);
		advance(MINUTE);
		tracker.finish();
		tracker.finish();
		expect(recorded).toHaveLength(1);
	});

	it("reports the running total without recording anything", () => {
		tracker.setEngaged(true);
		tracker.setContext(exam);
		advance(90_000);
		expect(tracker.currentActiveMs()).toBe(90_000);
		expect(recorded).toEqual([]);
	});
});

describe("formatDuration", () => {
	it.each([
		[0, "0s"],
		[45_000, "45s"],
		[12 * MINUTE + 59_000, "12m"],
		[60 * MINUTE, "1h"],
		[155 * MINUTE, "2h 35m"],
		[-5, "0s"],
	])("formats %d ms as %s", (ms, text) => {
		expect(formatDuration(ms)).toBe(text);
	});
});

const attempt = (id: string, examId: string, day: number, correct: number, total = 20): AttemptSummary => ({
	id,
	examId,
	examTitle: examId === "e-1" ? "Circuits" : "Algebra",
	submittedAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
	correct,
	total,
	marks: correct,
	maxMarks: total,
	percent: (correct / total) * 100,
});

describe("exam history", () => {
	const attempts = [attempt("r-c", "e-1", 3, 18), attempt("r-a", "e-1", 1, 10), attempt("r-x", "e-2", 2, 5, 10), attempt("r-b", "e-1", 2, 14)];

	it("numbers each exam's attempts in completion order, separately per exam", () => {
		const numbered = numberAttempts(attempts);
		const number = (id: string) => numbered.find((entry) => entry.id === id)?.attemptNumber;
		expect([number("r-a"), number("r-b"), number("r-c"), number("r-x")]).toEqual([1, 2, 3, 1]);
	});

	it("keeps all three attempts of one exam, oldest first, with their recorded percentages", () => {
		expect(examHistory(attempts, "e-1").map((entry) => [entry.attemptNumber, entry.percent])).toEqual([
			[1, 50],
			[2, 70],
			[3, 90],
		]);
	});

	it("uses the stored score even if the exam later has a different number of questions", () => {
		const changed = [...attempts, attempt("r-d", "e-1", 4, 3, 4)];
		const history = examHistory(changed, "e-1");
		expect(history.map((entry) => `${entry.correct}/${entry.total}`)).toEqual(["10/20", "14/20", "18/20", "3/4"]);
	});

	it("handles exams with one attempt or none", () => {
		expect(examHistory(attempts, "e-2")).toHaveLength(1);
		expect(examHistory(attempts, "e-missing")).toEqual([]);
	});
});

const local = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute);

const sessionBetween = (start: Date, end: Date, activeMs: number, kind: "practice" | "exam" = "practice"): StudySessionRecord => ({
	version: 1,
	id: `s-${start.getTime()}-${activeMs}`,
	kind,
	startedAt: start.toISOString(),
	endedAt: end.toISOString(),
	activeMs,
});

describe("dailyStudyTotals", () => {
	it("groups sessions by local calendar day", () => {
		const totals = dailyStudyTotals([
			sessionBetween(local(9, 24, 9), local(9, 24, 9, 30), 30 * MINUTE),
			sessionBetween(local(9, 24, 20), local(9, 24, 20, 10), 10 * MINUTE),
			sessionBetween(local(9, 25, 8), local(9, 25, 8, 20), 20 * MINUTE),
		]);
		expect(totals.get("2026-10-24")).toBe(40 * MINUTE);
		expect(totals.get("2026-10-25")).toBe(20 * MINUTE);
		expect(totals.has("2026-10-23")).toBe(false);
	});

	it("splits a session that crosses midnight between the two days", () => {
		const totals = dailyStudyTotals([sessionBetween(local(9, 24, 23, 30), local(9, 25, 0, 30), 40 * MINUTE)]);
		expect(totals.get("2026-10-24")).toBe(20 * MINUTE);
		expect(totals.get("2026-10-25")).toBe(20 * MINUTE);
	});

	it("keeps the overall total equal to the recorded active time", () => {
		const sessions = [
			sessionBetween(local(9, 20, 22), local(9, 22, 2), 90 * MINUTE),
			sessionBetween(local(9, 23, 12), local(9, 23, 12), 6_000),
		];
		const sum = [...dailyStudyTotals(sessions).values()].reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(90 * MINUTE + 6_000, 6);
	});
});

describe("compareWithYesterday", () => {
	it.each([
		[MINUTE * 125, MINUTE * 100, { kind: "up", percent: 25 }],
		[MINUTE * 60, MINUTE * 100, { kind: "down", percent: 40 }],
		[MINUTE * 30, MINUTE * 30, { kind: "same" }],
		[MINUTE * 30, 0, { kind: "no-baseline" }],
		[0, 0, { kind: "no-baseline" }],
		[0, MINUTE * 10, { kind: "down", percent: 100 }],
	])("compares %d with %d", (today, yesterday, expected) => {
		expect(compareWithYesterday(today, yesterday)).toEqual(expected);
	});
});

describe("attemptedExams", () => {
	it("lists each attempted exam once, most recently attempted first, with its latest title", () => {
		const attempts = [attempt("r-1", "e-1", 1, 10), attempt("r-2", "e-2", 3, 5, 10), attempt("r-3", "e-1", 2, 12)];
		attempts[2] = { ...attempts[2], examTitle: "Circuits (renamed)" };
		expect(attemptedExams(attempts).map((exam) => [exam.examId, exam.title])).toEqual([
			["e-2", "Algebra"],
			["e-1", "Circuits (renamed)"],
		]);
		expect(attemptedExams([])).toEqual([]);
	});
});

describe("summariseStudy", () => {
	it("reports today, yesterday and the all-time total from the session records", () => {
		const now = local(9, 25, 15);
		const overview = summariseStudy(
			[
				sessionBetween(local(9, 25, 9), local(9, 25, 10), 50 * MINUTE),
				sessionBetween(local(9, 24, 9), local(9, 24, 10), 40 * MINUTE, "exam"),
				sessionBetween(local(8, 1, 9), local(8, 1, 10), 30 * MINUTE),
			],
			[attempt("r-a", "e-1", 1, 10), attempt("r-b", "e-1", 2, 14), attempt("r-x", "e-2", 3, 9, 10)],
			now,
		);
		expect(overview).toMatchObject({ totalStudyMs: 120 * MINUTE, todayMs: 50 * MINUTE, yesterdayMs: 40 * MINUTE });
		expect(overview.daily.get("2026-09-01")).toBe(30 * MINUTE);
		expect(overview.recent.map((entry) => [entry.id, entry.attemptNumber])).toEqual([
			["r-x", 1],
			["r-b", 2],
			["r-a", 1],
		]);
	});

	it("is empty, not invented, when nothing has been recorded", () => {
		const overview = summariseStudy([], [], local(9, 25, 12));
		expect(overview).toMatchObject({ totalStudyMs: 0, todayMs: 0, yesterdayMs: 0, recent: [] });
		expect(overview.daily.size).toBe(0);
	});

	it("limits the recent list", () => {
		const many = Array.from({ length: 12 }, (_, index) => attempt(`r-${index}`, "e-1", index + 1, index));
		expect(summariseStudy([], many, local(9, 25), 5).recent).toHaveLength(5);
	});
});
