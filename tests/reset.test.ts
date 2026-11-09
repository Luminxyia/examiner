import { describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../src/core/definition";
import { StudyTracker, type StudySessionRecord } from "../src/core/study-time";
import { JsonLibrary } from "../src/storage/json-library";
import { parseQuestionRecord, questionRecord } from "../src/storage/question-format";
import { ResultsStore, type ExamResultRecord } from "../src/storage/results";
import { FakeDataFiles } from "./fake-files";
import { basicAddition } from "./helpers";

const PATH = "plugin/questions.json";
const format = { collection: "questions", parse: parseQuestionRecord, toRecord: questionRecord };

const result: ExamResultRecord = {
	version: 1,
	id: "r-1",
	examId: "e-1",
	examTitle: "Mock",
	startedAt: new Date(0).toISOString(),
	submittedAt: new Date(1_000).toISOString(),
	timeLimitMinutes: null,
	timedOut: false,
	items: [],
	summary: { total: 1, correct: 1, incorrect: 0, unanswered: 0, percent: 100, byQuestion: [], byTag: [] },
};

describe("resetting plugin data", () => {
	it("removes every question and leaves other files alone", async () => {
		const files = new FakeDataFiles();
		files.files.set("Notes/My note.md", "# Untouched");
		files.files.set("plugin/data.json", "{}");
		const library = new JsonLibrary<QuestionDefinition>(files, format, PATH);
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second" }));
		let notified = 0;
		library.onChange(() => notified++);

		await library.clear();

		expect(library.definitions()).toEqual([]);
		expect(library.problems()).toEqual([]);
		expect(JSON.parse(files.files.get(PATH) ?? "null")).toEqual({ version: 1, questions: {} });
		expect(files.files.get("Notes/My note.md")).toBe("# Untouched");
		expect(files.files.get("plugin/data.json")).toBe("{}");
		expect(notified).toBe(1);
	});

	it("still reflects what is stored when clearing fails", async () => {
		const files = new FakeDataFiles();
		const library = new JsonLibrary<QuestionDefinition>(files, format, PATH);
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second" }));
		files.write = () => Promise.reject(new Error("Locked"));

		await expect(library.clear()).rejects.toThrow("Locked");
		expect(library.definitions()).toHaveLength(2);
	});

	it("deletes results, study history and the exam in progress, and reads them back as empty", async () => {
		const files = new FakeDataFiles();
		files.files.set("plugin/data.json", "{\"exampleCreated\":true}");
		const store = new ResultsStore(files, "plugin");
		await store.recordExamResult(result);
		await store.recordPracticeAttempt({
			version: 1,
			id: "a-1",
			questionId: "q",
			questionTitle: "Q",
			tags: [],
			submittedAt: new Date(0).toISOString(),
			prompt: "",
			inputs: {},
			steps: [],
			answer: 1,
			expectedDisplay: "1",
			response: "1",
			correct: true,
		});
		await store.recordStudySession({ version: 1, id: "s-1", kind: "practice", startedAt: new Date(0).toISOString(), endedAt: new Date(60_000).toISOString(), activeMs: 60_000 });
		await store.saveSession({ version: 1, examId: "e-1", examTitle: "Mock", startedAt: new Date(0).toISOString(), deadline: null, timeLimitMinutes: null, items: [], responses: [], current: 0 });
		await store.saveStudyTimer(new Date(0).toISOString());
		expect(await store.readExamResults()).toHaveLength(1);
		let notified = 0;
		store.onChange(() => notified++);

		await store.clearAll();

		expect([...files.files.keys()]).toEqual(["plugin/data.json"]);
		expect(await store.readExamResults()).toEqual([]);
		expect(await store.readStudySessions()).toEqual([]);
		expect(await store.readPracticeAttempts()).toEqual([]);
		expect(await store.loadSession()).toBeNull();
		expect(await store.loadStudyTimer()).toBeNull();
		expect(notified).toBe(1);
	});

	it("drops the study time being counted instead of writing it after a reset", () => {
		let clock = 0;
		const recorded: StudySessionRecord[] = [];
		const tracker = new StudyTracker(() => clock, () => "s", (record) => recorded.push(record));
		tracker.setEngaged(true);
		tracker.setContext({ kind: "practice", key: "practice:q", questionId: "q" });
		clock += 120_000;
		tracker.discard();
		clock += 1_000;
		tracker.setContext(null);
		expect(recorded).toEqual([]);
	});
});
