import { describe, expect, it } from "vitest";
import type { ExamDefinition } from "../src/core/exam";
import { blankFlashcard, type QuestionDefinition } from "../src/core/definition";
import { examRecord, parseExamRecord } from "../src/storage/exam-format";
import { createId } from "../src/storage/format-shared";
import { parseQuestionRecord, questionRecord } from "../src/storage/question-format";
import { ResultsStore, toAttemptSummary, type ExamResultRecord, type ExamSession, type PracticeAttemptRecord } from "../src/storage/results";
import { FakeDataFiles } from "./fake-files";
import { basicAddition, roundTripExam, roundTripQuestion } from "./helpers";

const multiStep: QuestionDefinition = {
	id: "q-multi001",
	title: "Hypotenuse of equal sides",
	prompt: "Sides of {x} and {y} are added to give {z}.\n\nFind $\\sqrt{2}$ times {z}.",
	variables: [
		{ name: "x", source: { kind: "integer", min: 1, max: 20 } },
		{ name: "y", source: { kind: "decimal", min: 0.5, max: 2.5, places: 1 } },
		{ name: "g", source: { kind: "fixed", value: 9.81 } },
	],
	steps: [
		{ target: "z", expression: "{x} + {y}" },
		{ target: "answer", expression: "sqrt({z}^2 + {z}^2) + {g} * 0" },
	],
	answer: { check: "rounded", places: 2 },
	kind: "calculation",
	flashcard: blankFlashcard(),
	marks: 3,
	tags: ["maths", "geometry/triangles"],
};

describe("question records", () => {
	it("round-trips every kind of variable, step and answer rule", () => {
		for (const answer of [
			{ check: "exact" },
			{ check: "rounded", places: 0 },
			{ check: "absolute", tolerance: 0.05 },
			{ check: "relative", percent: 2 },
		] as const) {
			const definition = { ...multiStep, answer };
			expect(roundTripQuestion(definition)).toEqual({ ok: true, definition });
		}
	});

	it("writes readable properties with the question text as the prompt", () => {
		const record = questionRecord(basicAddition());
		expect(record).toMatchObject({ type: "calculation", title: "Basic addition", prompt: "What is {x} + {y}?" });
		expect(record.steps).toEqual(["{answer} = {x} + {y}"]);
		expect(record).not.toHaveProperty("id");
	});

	it("loads non-numeric values as NaN so validation can point at them", () => {
		const result = parseQuestionRecord("q", { variables: [{ name: "x", type: "integer", min: "a", max: 2 }] });
		expect(result.ok && result.definition.variables[0]?.source).toEqual({ kind: "integer", min: Number.NaN, max: 2 });
	});

	it("writes incomplete numbers as empty values and reads them back", () => {
		const definition = basicAddition({
			variables: [{ name: "x", source: { kind: "integer", min: Number.NaN, max: 3 } }],
			answer: { check: "rounded", places: Number.NaN },
		});
		expect(JSON.stringify(questionRecord(definition))).toContain('"min":null');
		expect(roundTripQuestion(definition)).toEqual({ ok: true, definition });
	});

	it("accepts hand-written variations", () => {
		const result = parseQuestionRecord("q-hand", {
			title: "Hand written",
			tags: "maths, Physics // Circuits",
			variables: [{ name: "x", type: "integer", min: "1", max: 5 }],
			steps: ["answer = {x} * 2"],
			prompt: "Double {x}.",
		});
		expect(result).toEqual({
			ok: true,
			definition: {
				id: "q-hand",
				kind: "calculation",
				title: "Hand written",
				prompt: "Double {x}.",
				variables: [{ name: "x", source: { kind: "integer", min: 1, max: 5 } }],
				steps: [{ target: "answer", expression: "{x} * 2" }],
				answer: { check: "exact" },
				flashcard: blankFlashcard(),
				marks: 1,
				tags: ["maths", "Physics/Circuits"],
			},
		});
	});

	const writtenCard: QuestionDefinition = {
		...basicAddition({ id: "q-card0001", title: "Resonant frequency", tags: ["physics"] }),
		kind: "flashcard",
		prompt: "What is resonant frequency?",
		flashcard: {
			mode: "written",
			answer: "The frequency at which a system oscillates with maximum amplitude when driven by an external force.",
			options: [],
			correct: 0,
		},
		variables: [],
		steps: [],
		marks: 5,
	};

	const choiceCard: QuestionDefinition = {
		...writtenCard,
		id: "q-card0002",
		flashcard: { mode: "choice", answer: "", options: ["Ohm", "Farad", "Henry"], correct: 1 },
		marks: 2,
	};

	it.each([
		["a written flashcard", writtenCard],
		["a multiple-choice flashcard", choiceCard],
	])("round-trips %s", (_label, definition) => {
		const result = roundTripQuestion(definition);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.definition.kind).toBe("flashcard");
		expect(result.definition.marks).toBe(definition.marks);
		expect(result.definition.prompt).toBe(definition.prompt);
		expect(result.definition.flashcard.mode).toBe(definition.flashcard.mode);
		if (definition.flashcard.mode === "written") expect(result.definition.flashcard.answer).toBe(definition.flashcard.answer);
		else expect(result.definition.flashcard).toMatchObject({ options: definition.flashcard.options, correct: definition.flashcard.correct });
		expect(questionRecord(result.definition)).toEqual(questionRecord(definition));
	});

	it("only writes the properties of the question's own type", () => {
		const card = questionRecord(choiceCard);
		expect(card).toMatchObject({ type: "flashcard", answerMode: "multiple-choice", correctOption: 2 });
		expect(card).not.toHaveProperty("steps");
		expect(card).not.toHaveProperty("variables");
		const calculation = questionRecord(multiStep);
		expect(calculation).toMatchObject({ type: "calculation" });
		expect(calculation).not.toHaveProperty("expectedAnswer");
	});

	it("defaults a question without a type or marks to a 1-mark calculation question", () => {
		const result = parseQuestionRecord("q-old", { prompt: "Old" });
		expect(result.ok && result.definition).toMatchObject({ kind: "calculation", marks: 1 });
	});

	it.each([
		[{ type: "essay" }, 'Unknown question type "essay"'],
		[{ type: "flashcard", answerMode: "oral" }, 'Unknown answer mode "oral"'],
		[{ type: "flashcard", answerMode: "multiple-choice", options: "nope" }, "must be a list"],
		["not an object", "set of properties"],
		[{ variables: "nope" }, '"variables" must be a list'],
		[{ variables: [{ name: "x", type: "random" }] }, 'unknown type "random"'],
		[{ steps: [42] }, "must look like"],
		[{ answer: { check: "fuzzy" } }, 'Unknown answer check "fuzzy"'],
	])("reports invalid records: %#", (record, message) => {
		const result = parseQuestionRecord("q", record);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toContain(message);
	});

	it("loads a missing correct option so validation can point at it", () => {
		const result = parseQuestionRecord("q", { type: "flashcard", answerMode: "multiple-choice", options: ["A", "B"], prompt: "Pick" });
		expect(result.ok && result.definition.flashcard.correct).toBe(-1);
	});
});

describe("exam records", () => {
	const exam: ExamDefinition = {
		id: "e-1",
		title: "Mock exam",
		tags: ["circuits"],
		timeLimitMinutes: 90,
		passingPercent: 70,
		questions: [
			{ questionId: "q-1", count: 2 },
			{ questionId: "q-2", count: 1 },
		],
	};

	it("round-trips", () => {
		expect(roundTripExam(exam)).toEqual({ ok: true, definition: exam });
		const untimed = { ...exam, timeLimitMinutes: null };
		expect(roundTripExam(untimed)).toEqual({ ok: true, definition: untimed });
	});

	it("writes the time limit as a readable duration", () => {
		expect(examRecord(exam).timeLimit).toBe("1hr 30min");
		expect(examRecord({ ...exam, timeLimitMinutes: null }).timeLimit).toBe("none");
	});

	it("stores the passing grade and defaults an exam without one to 50%", () => {
		expect(examRecord(exam).passingGrade).toBe(70);
		const without = parseExamRecord("e", { questions: ["q-1"] });
		expect(without.ok && without.definition.passingPercent).toBe(50);
		const withPercentSign = parseExamRecord("e", { passingGrade: "65%" });
		expect(withPercentSign.ok && withPercentSign.definition.passingPercent).toBe(65);
		for (const edge of [0, 100]) {
			const parsed = parseExamRecord("e", { passingGrade: edge });
			expect(parsed.ok && parsed.definition.passingPercent).toBe(edge);
		}
	});

	it.each(["101", "-1", "50.5", "half"])("rejects a passing grade of %s", (value) => {
		const parsed = parseExamRecord("e", { passingGrade: value });
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.errors.join(" ")).toContain("whole number from 0 to 100");
	});

	it("accepts bare IDs and rejects bad counts and durations", () => {
		const result = parseExamRecord("e", { questions: ["q-1"] });
		expect(result.ok && result.definition.questions).toEqual([{ questionId: "q-1", count: 1 }]);

		const badCount = parseExamRecord("e", { questions: [{ id: "q-1", count: 0 }] });
		expect(!badCount.ok && badCount.errors[0]).toContain("count of at least 1");
		const badTime = parseExamRecord("e", { timeLimit: "soon" });
		expect(!badTime.ok && badTime.errors[0]).toContain("duration");
	});
});

describe("IDs", () => {
	it("creates distinct IDs with the right prefix", () => {
		const ids = new Set(Array.from({ length: 200 }, () => createId("q")));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(/^q-[a-z0-9]{8}$/);
	});
});

describe("ResultsStore", () => {
	const attempt = (correct: boolean): PracticeAttemptRecord => ({
		version: 1,
		id: createId("a"),
		questionId: "q-1",
		questionTitle: "Basic addition",
		tags: [],
		submittedAt: new Date(0).toISOString(),
		prompt: "What is 1 + 2?",
		inputs: { x: 1, y: 2 },
		steps: [{ target: "answer", expression: "{x} + {y}", value: 3 }],
		answer: 3,
		expectedDisplay: "3",
		response: correct ? "3" : "4",
		correct,
	});

	it("appends each attempt and reads them back after a reload", async () => {
		const files = new FakeDataFiles();
		await new ResultsStore(files, "plugin").recordPracticeAttempt(attempt(true));
		await new ResultsStore(files, "plugin").recordPracticeAttempt(attempt(false));
		const records = await new ResultsStore(files, "plugin").readPracticeAttempts();
		expect(records.map((record) => record.correct)).toEqual([true, false]);
	});

	it("keeps exam results apart from practice attempts", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		await store.recordPracticeAttempt(attempt(true));
		expect(await store.readExamResults()).toEqual([]);
		expect([...files.files.keys()]).toEqual(["plugin/practice-attempts.jsonl"]);
	});

	it("skips damaged lines", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		await store.recordPracticeAttempt(attempt(true));
		await files.append("plugin/practice-attempts.jsonl", '{"truncated": \n');
		await store.recordPracticeAttempt(attempt(false));
		expect(await store.readPracticeAttempts()).toHaveLength(2);
	});

	it("saves, restores and clears an interrupted exam session", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		expect(await store.loadSession()).toBeNull();
		const session: ExamSession = {
			version: 1,
			examId: "e-1",
			examTitle: "Mock",
			startedAt: new Date(0).toISOString(),
			deadline: 1_000,
			timeLimitMinutes: 10,
			items: [],
			responses: ["12", ""],
			current: 1,
		};
		await store.saveSession(session);
		expect(await new ResultsStore(files, "plugin").loadSession()).toEqual(session);
		await store.clearSession();
		expect(await store.loadSession()).toBeNull();
	});

	it("keeps marking decisions when a session in the marking step is reloaded", async () => {
		const files = new FakeDataFiles();
		const session: ExamSession = {
			version: 1,
			attemptId: "r-1",
			examId: "e-1",
			examTitle: "Mock",
			startedAt: new Date(0).toISOString(),
			deadline: null,
			timeLimitMinutes: null,
			items: [],
			responses: ["An answer", "Another"],
			current: 1,
			marking: { submittedAt: new Date(5_000).toISOString(), timedOut: false, activeMs: 4_000, judgements: ["partial", null], current: 1 },
		};
		await new ResultsStore(files, "plugin").saveSession(session);
		expect((await new ResultsStore(files, "plugin").loadSession())?.marking).toEqual(session.marking);
	});

	const result = (id: string, percent = 50): ExamResultRecord => ({
		version: 1,
		id,
		examId: "e-1",
		examTitle: "Mock",
		startedAt: new Date(0).toISOString(),
		submittedAt: new Date(1_000).toISOString(),
		timeLimitMinutes: null,
		timedOut: false,
		items: [],
		summary: { total: 2, correct: 1, incorrect: 1, unknown: 0, unanswered: 0, percent, byQuestion: [], byTag: [] },
		activeMs: 30_000,
	});

	it("appends every attempt and never records the same attempt twice", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		expect(await store.recordExamResult(result("r-1", 50))).toBe(true);
		expect(await store.recordExamResult(result("r-2", 70))).toBe(true);
		expect(await store.recordExamResult(result("r-1", 50))).toBe(false);
		const reloaded = await new ResultsStore(files, "plugin").readExamResults();
		expect(reloaded.map((record) => [record.id, record.summary.percent])).toEqual([
			["r-1", 50],
			["r-2", 70],
		]);
	});

	it("keeps concurrent writes in order without losing any", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		await Promise.all([store.recordExamResult(result("r-1")), store.recordExamResult(result("r-2")), store.recordExamResult(result("r-3"))]);
		expect((await store.readExamResults()).map((record) => record.id)).toEqual(["r-1", "r-2", "r-3"]);
		expect((await new ResultsStore(files, "plugin").readExamResults()).map((record) => record.id)).toEqual(["r-1", "r-2", "r-3"]);
	});

	it("skips malformed and incomplete attempt and session records", async () => {
		const files = new FakeDataFiles();
		await files.write(
			"plugin/exam-results.jsonl",
			[JSON.stringify(result("r-1")), "{broken", JSON.stringify({ id: "r-2", examId: "e-1" }), JSON.stringify({ ...result("r-3"), activeMs: "soon" }), ""].join("\n"),
		);
		await files.write(
			"plugin/study-sessions.jsonl",
			[
				JSON.stringify({ version: 1, id: "s-1", kind: "practice", startedAt: new Date(0).toISOString(), endedAt: new Date(5_000).toISOString(), activeMs: 5_000 }),
				JSON.stringify({ version: 1, id: "s-2", kind: "practice", startedAt: "never", endedAt: "never", activeMs: 5_000 }),
				JSON.stringify({ version: 1, id: "s-3", kind: "exam", startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), activeMs: -1 }),
			].join("\n"),
		);
		const store = new ResultsStore(files, "plugin");
		expect((await store.readExamResults()).map((record) => record.id)).toEqual(["r-1"]);
		expect((await store.readStudySessions()).map((record) => record.id)).toEqual(["s-1"]);
	});

	it("abandoning an exam clears its session without recording an attempt", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		await store.saveSession({
			version: 1,
			attemptId: "r-9",
			examId: "e-1",
			examTitle: "Mock",
			startedAt: new Date(0).toISOString(),
			deadline: null,
			timeLimitMinutes: null,
			items: [],
			responses: [],
			current: 0,
		});
		await store.clearSession();
		expect(await store.loadSession()).toBeNull();
		expect(await new ResultsStore(files, "plugin").readExamResults()).toEqual([]);
	});

	it("treats missing statistics files as empty", async () => {
		const store = new ResultsStore(new FakeDataFiles(), "plugin");
		expect(await store.readExamResults()).toEqual([]);
		expect(await store.readStudySessions()).toEqual([]);
	});

	it("persists study sessions across reloads and ignores duplicates", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		const session = { version: 1 as const, id: "s-1", kind: "exam" as const, startedAt: new Date(0).toISOString(), endedAt: new Date(60_000).toISOString(), activeMs: 60_000, attemptId: "r-1" };
		await store.recordStudySession(session);
		await store.recordStudySession(session);
		expect(await new ResultsStore(files, "plugin").readStudySessions()).toEqual([session]);
	});

	it("keeps manual study sessions apart from exam sessions", async () => {
		const files = new FakeDataFiles();
		const session = { version: 1 as const, id: "s-2", kind: "manual" as const, startedAt: new Date(0).toISOString(), endedAt: new Date(60_000).toISOString(), activeMs: 60_000 };
		await new ResultsStore(files, "plugin").recordStudySession(session);
		const sessions = await new ResultsStore(files, "plugin").readStudySessions();
		expect(sessions).toEqual([session]);
		expect(sessions[0]?.kind).toBe("manual");
	});

	it("saves, restores and clears a running study timer", async () => {
		const files = new FakeDataFiles();
		const store = new ResultsStore(files, "plugin");
		expect(await store.loadStudyTimer()).toBeNull();
		const startedAt = new Date(5_000).toISOString();
		await store.saveStudyTimer(startedAt);
		expect(await new ResultsStore(files, "plugin").loadStudyTimer()).toBe(startedAt);
		await store.clearStudyTimer();
		expect(await store.loadStudyTimer()).toBeNull();
	});

	it("ignores a corrupt study timer file", async () => {
		const files = new FakeDataFiles();
		await files.write("plugin/study-timer.json", "{not json");
		expect(await new ResultsStore(files, "plugin").loadStudyTimer()).toBeNull();
	});

	it("ignores a corrupt session file", async () => {
		const files = new FakeDataFiles();
		await files.write("plugin/exam-session.json", "{not json");
		expect(await new ResultsStore(files, "plugin").loadSession()).toBeNull();
	});
});

describe("historical exam results", () => {
	const legacy = {
		version: 1,
		id: "r-old",
		examId: "e-1",
		examTitle: "Mock",
		startedAt: new Date(0).toISOString(),
		submittedAt: new Date(1_000).toISOString(),
		timeLimitMinutes: null,
		timedOut: false,
		items: [{ questionId: "q-1", title: "Old", tags: [], prompt: "1 + 1", instruction: null, inputs: {}, steps: [], answer: 2, expectedDisplay: "2", response: "2", outcome: "correct" }],
		summary: { total: 3, correct: 2, incorrect: 1, unanswered: 0, percent: 200 / 3, byQuestion: [], byTag: [] },
	};

	it("reads records saved before weighted marks without changing them", async () => {
		const files = new FakeDataFiles();
		await files.write("plugin/exam-results.jsonl", `${JSON.stringify(legacy)}\n`);
		const [record] = await new ResultsStore(files, "plugin").readExamResults();
		expect(record).toEqual(legacy);
		expect(record && toAttemptSummary(record)).toMatchObject({ correct: 2, total: 3, marks: 2, maxMarks: 3, percent: 200 / 3 });
	});

	it("uses the stored weighted marks for newer records", () => {
		const weighted = { ...legacy, summary: { ...legacy.summary, marks: 7.5, maxMarks: 10, percent: 75 } } as ExamResultRecord;
		expect(toAttemptSummary(weighted)).toMatchObject({ marks: 7.5, maxMarks: 10, percent: 75 });
	});
});
