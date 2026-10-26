import { describe, expect, it } from "vitest";
import type { ExamDefinition } from "../src/core/exam";
import { blankFlashcard, type QuestionDefinition } from "../src/core/definition";
import { parseExamFile, serializeExam } from "../src/storage/exam-format";
import { createId } from "../src/storage/format-shared";
import { splitFrontmatter } from "../src/storage/frontmatter";
import { parseQuestionFile, serializeQuestion } from "../src/storage/question-format";
import { ResultsStore, toAttemptSummary, type ExamResultRecord, type ExamSession, type PracticeAttemptRecord } from "../src/storage/results";
import { FakeDataFiles } from "./fake-files";
import { basicAddition } from "./helpers";

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

describe("question file format", () => {
	it("round-trips every kind of variable, step and answer rule", () => {
		for (const answer of [
			{ check: "exact" },
			{ check: "rounded", places: 0 },
			{ check: "absolute", tolerance: 0.05 },
			{ check: "relative", percent: 2 },
		] as const) {
			const definition = { ...multiStep, answer };
			expect(parseQuestionFile(serializeQuestion(definition))).toEqual({ ok: true, definition });
		}
	});

	it("writes readable markdown with the question text as the body", () => {
		const content = serializeQuestion(basicAddition());
		expect(content).toMatch(/^---\n/);
		expect(content).toContain("examiner: question\n");
		expect(content).toContain("examiner-title: Basic addition\n");
		expect(content).toContain("{answer} = {x} + {y}");
		expect(splitFrontmatter(content).body).toBe("What is {x} + {y}?\n");
	});

	it("keeps properties the plugin does not manage", () => {
		const original = "---\naliases: [sum]\nexaminer: question\nexaminer-id: q-1\nrating: 5\n---\nOld prompt\n";
		const updated = serializeQuestion(basicAddition({ id: "q-1" }), original);
		expect(updated).toContain("aliases:\n  - sum\n");
		expect(updated).toContain("rating: 5\n");
		expect(updated.indexOf("aliases")).toBeLessThan(updated.indexOf("examiner:"));
		expect(splitFrontmatter(updated).body).toBe("What is {x} + {y}?\n");
	});

	it("loads non-numeric values as NaN so validation can point at them", () => {
		const content = "---\nexaminer: question\nexaminer-id: q\nexaminer-variables:\n  - { name: x, type: integer, min: a, max: 2 }\n---\n";
		const result = parseQuestionFile(content);
		expect(result.ok && result.definition.variables[0]?.source).toEqual({ kind: "integer", min: Number.NaN, max: 2 });
	});

	it("writes incomplete numbers as empty values and reads them back", () => {
		const definition = basicAddition({
			variables: [{ name: "x", source: { kind: "integer", min: Number.NaN, max: 3 } }],
			answer: { check: "rounded", places: Number.NaN },
		});
		const content = serializeQuestion(definition);
		expect(content).toContain("min: null");
		expect(parseQuestionFile(content)).toEqual({ ok: true, definition });
	});

	it("does not treat Obsidian tags as examiner tags", () => {
		const content = "---\nexaminer: question\nexaminer-id: q-1\ntags: [obsidian-tag]\n---\nPrompt with #hashtag\n";
		const result = parseQuestionFile(content);
		expect(result.ok && result.definition.tags).toEqual([]);
	});

	it("accepts hand-written variations", () => {
		const content = [
			"---",
			"examiner: question",
			"examiner-id: q-hand",
			"examiner-title: Hand written",
			"examiner-tags: maths, Physics // Circuits",
			"examiner-variables:",
			"  - { name: x, type: integer, min: '1', max: 5 }",
			"examiner-steps:",
			"  - answer = {x} * 2",
			"---",
			"Double {x}.",
		].join("\n");
		const result = parseQuestionFile(content);
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
		const result = parseQuestionFile(serializeQuestion(definition));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.definition.kind).toBe("flashcard");
		expect(result.definition.marks).toBe(definition.marks);
		expect(result.definition.prompt).toBe(definition.prompt);
		expect(result.definition.flashcard.mode).toBe(definition.flashcard.mode);
		if (definition.flashcard.mode === "written") expect(result.definition.flashcard.answer).toBe(definition.flashcard.answer);
		else expect(result.definition.flashcard).toMatchObject({ options: definition.flashcard.options, correct: definition.flashcard.correct });
		expect(serializeQuestion(result.definition)).toBe(serializeQuestion(definition));
	});

	it("writes flashcards readably and marks them as a newer format", () => {
		const { frontmatter } = splitFrontmatter(serializeQuestion(choiceCard));
		expect(frontmatter).toContain("examiner-version: 2");
		expect(frontmatter).toContain("examiner-type: flashcard");
		expect(frontmatter).toContain("examiner-answer-mode: multiple-choice");
		expect(frontmatter).toContain("examiner-correct-option: 2");
		expect(frontmatter).not.toContain("examiner-steps");
		expect(splitFrontmatter(serializeQuestion(multiStep)).frontmatter).toContain("examiner-version: 1");
	});

	it("drops the other type's properties when a question changes type", () => {
		const asFlashcard = serializeQuestion(writtenCard, serializeQuestion(multiStep));
		expect(asFlashcard).not.toContain("examiner-variables");
		const backToCalculation = serializeQuestion({ ...multiStep, id: writtenCard.id }, asFlashcard);
		expect(backToCalculation).not.toContain("examiner-expected-answer");
		expect(backToCalculation).toContain("examiner-type: calculation");
	});

	it("defaults older questions without a type or marks to a 1-mark calculation question", () => {
		const result = parseQuestionFile("---\nexaminer: question\nexaminer-version: 1\nexaminer-id: q-old\n---\nOld");
		expect(result.ok && result.definition).toMatchObject({ kind: "calculation", marks: 1 });
	});

	it.each([
		["---\nexaminer: question\nexaminer-id: q\nexaminer-type: essay\n---\n", 'Unknown question type "essay"'],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-type: flashcard\nexaminer-answer-mode: oral\n---\n", 'Unknown answer mode "oral"'],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-type: flashcard\nexaminer-answer-mode: multiple-choice\nexaminer-options: nope\n---\n", "must be a list"],
	])("reports invalid flashcard files: %#", (content, message) => {
		const result = parseQuestionFile(content);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toContain(message);
	});

	it("loads a missing correct option so validation can point at it", () => {
		const result = parseQuestionFile(
			"---\nexaminer: question\nexaminer-id: q\nexaminer-type: flashcard\nexaminer-answer-mode: multiple-choice\nexaminer-options: [A, B]\n---\nPick",
		);
		expect(result.ok && result.definition.flashcard.correct).toBe(-1);
	});

	it.each([
		["---\nexaminer: question\nexaminer-id: [unclosed\n---\n", "not valid YAML"],
		["---\nexaminer: question\n---\nPrompt", 'Missing "examiner-id"'],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-variables: nope\n---\n", "must be a list"],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-variables:\n  - { name: x, type: random }\n---\n", 'unknown type "random"'],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-steps:\n  - 42\n---\n", "must look like"],
		["---\nexaminer: question\nexaminer-id: q\nexaminer-answer: { check: fuzzy }\n---\n", 'Unknown answer check "fuzzy"'],
		["---\nexaminer: question\nexaminer-version: 99\nexaminer-id: q\n---\n", "newer version of Examiner"],
	])("reports invalid files: %#", (content, message) => {
		const result = parseQuestionFile(content);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toContain(message);
	});
});

describe("exam file format", () => {
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
		expect(parseExamFile(serializeExam(exam))).toEqual({ ok: true, definition: exam });
		const untimed = { ...exam, timeLimitMinutes: null };
		expect(parseExamFile(serializeExam(untimed))).toEqual({ ok: true, definition: untimed });
	});

	it("writes the time limit as a readable duration", () => {
		expect(serializeExam(exam)).toContain("examiner-time-limit: 1hr 30min\n");
		expect(serializeExam({ ...exam, timeLimitMinutes: null })).toContain("examiner-time-limit: none\n");
	});

	it("keeps the note body and other properties", () => {
		const original = "---\nexaminer: exam\nexaminer-id: e-1\nsource: textbook\n---\nMy revision notes.\n";
		const updated = serializeExam(exam, original);
		expect(updated).toContain("source: textbook\n");
		expect(splitFrontmatter(updated).body).toBe("My revision notes.\n");
	});

	it("stores the passing grade and defaults older exams without one to 50%", () => {
		expect(serializeExam(exam)).toContain("examiner-passing-grade: 70\n");
		const older = parseExamFile("---\nexaminer: exam\nexaminer-id: e\nexaminer-questions: [q-1]\n---\n");
		expect(older.ok && older.definition.passingPercent).toBe(50);
		const withPercentSign = parseExamFile("---\nexaminer: exam\nexaminer-id: e\nexaminer-passing-grade: 65%\n---\n");
		expect(withPercentSign.ok && withPercentSign.definition.passingPercent).toBe(65);
		for (const edge of [0, 100]) {
			const parsed = parseExamFile(`---\nexaminer: exam\nexaminer-id: e\nexaminer-passing-grade: ${edge}\n---\n`);
			expect(parsed.ok && parsed.definition.passingPercent).toBe(edge);
		}
	});

	it.each(["101", "-1", "50.5", "half"])("rejects a passing grade of %s", (value) => {
		const parsed = parseExamFile(`---\nexaminer: exam\nexaminer-id: e\nexaminer-passing-grade: ${value}\n---\n`);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.errors.join(" ")).toContain("whole number from 0 to 100");
	});

	it("accepts bare IDs and rejects bad counts and durations", () => {
		const shorthand = "---\nexaminer: exam\nexaminer-id: e\nexaminer-questions: [q-1]\n---\n";
		const result = parseExamFile(shorthand);
		expect(result.ok && result.definition.questions).toEqual([{ questionId: "q-1", count: 1 }]);

		const badCount = parseExamFile("---\nexaminer: exam\nexaminer-id: e\nexaminer-questions:\n  - { id: q-1, count: 0 }\n---\n");
		expect(!badCount.ok && badCount.errors[0]).toContain("count of at least 1");
		const badTime = parseExamFile("---\nexaminer: exam\nexaminer-id: e\nexaminer-time-limit: soon\n---\n");
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
