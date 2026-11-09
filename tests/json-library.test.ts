import { beforeEach, describe, expect, it } from "vitest";
import { blankFlashcard, type QuestionDefinition } from "../src/core/definition";
import type { ExamDefinition } from "../src/core/exam";
import { examRecord, parseExamRecord } from "../src/storage/exam-format";
import { JsonLibrary } from "../src/storage/json-library";
import { parseQuestionRecord, questionRecord } from "../src/storage/question-format";
import { FakeDataFiles } from "./fake-files";
import { basicAddition } from "./helpers";

const PATH = "examiner/questions.json";
const BACKUP = `${PATH}.bak`;
const TEMPORARY = `${PATH}.tmp`;
const questionFormat = { collection: "questions", parse: parseQuestionRecord, toRecord: questionRecord };

class MemoryFiles extends FakeDataFiles {
	failRenameTo: string | null = null;

	override rename(from: string, to: string): Promise<void> {
		if (to === this.failRenameTo) {
			return Promise.reject(new Error("Rename failed"));
		}
		return super.rename(from, to);
	}
}

describe("JsonLibrary", () => {
	let files: MemoryFiles;
	let library: JsonLibrary<QuestionDefinition>;

	beforeEach(() => {
		files = new MemoryFiles();
		library = new JsonLibrary(files, questionFormat, PATH);
	});

	const reload = async () => {
		const fresh = new JsonLibrary(files, questionFormat, PATH);
		await fresh.load();
		return fresh;
	};

	const stored = (path = PATH) => JSON.parse(files.files.get(path) ?? "null") as { version: number; questions: Record<string, unknown> };

	it("starts empty when there is no file", async () => {
		await library.load();
		expect(library.definitions()).toEqual([]);
		expect(files.files.size).toBe(0);
	});

	it("stores every item in one file, keyed by ID", async () => {
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second", title: "Another" }));
		expect([...files.files.keys()].sort()).toEqual([PATH, BACKUP].sort());
		expect(stored().version).toBe(1);
		expect(Object.keys(stored().questions).sort()).toEqual(["q-second", "q-test0001"]);
	});

	it("restores definitions after a restart, sorted by title", async () => {
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second", title: "Another" }));
		const reloaded = await reload();
		expect(reloaded.definitions().map((definition) => definition.title)).toEqual(["Another", "Basic addition"]);
		expect(reloaded.get("q-test0001")).toEqual(basicAddition());
	});

	it("rejects a repeated ID and saving an unknown ID", async () => {
		await library.create(basicAddition());
		await expect(library.create(basicAddition())).rejects.toThrow("already exists");
		await expect(library.save(basicAddition({ id: "q-unknown" }))).rejects.toThrow("No item");
	});

	it("updates and deletes items", async () => {
		await library.create(basicAddition());
		await library.save(basicAddition({ prompt: "Add {x} and {y}." }));
		expect((await reload()).get("q-test0001")?.prompt).toBe("Add {x} and {y}.");
		await library.delete("q-test0001");
		expect(library.has("q-test0001")).toBe(false);
		expect((await reload()).definitions()).toEqual([]);
	});

	it("clears every item but keeps the previous version as a backup", async () => {
		await library.create(basicAddition());
		await library.clear();
		expect(library.definitions()).toEqual([]);
		expect(Object.keys(stored().questions)).toEqual([]);
		expect(Object.keys(stored(BACKUP).questions)).toEqual(["q-test0001"]);
	});

	it("keeps the previous version as a backup and leaves no temporary file", async () => {
		await library.create(basicAddition());
		await library.save(basicAddition({ prompt: "Changed {x} {y}." }));
		expect(files.files.has(TEMPORARY)).toBe(false);
		expect(JSON.stringify(stored(BACKUP))).not.toContain("Changed");
		expect(JSON.stringify(stored())).toContain("Changed");
	});

	it("keeps simultaneous saves", async () => {
		await Promise.all([
			library.create(basicAddition({ id: "q-a" })),
			library.create(basicAddition({ id: "q-b" })),
			library.create(basicAddition({ id: "q-c" })),
		]);
		expect(Object.keys(stored().questions).sort()).toEqual(["q-a", "q-b", "q-c"]);
	});

	it("does not lose items added to the file after loading", async () => {
		await library.create(basicAddition());
		const other = new JsonLibrary(files, questionFormat, PATH);
		await other.create(basicAddition({ id: "q-external" }));
		await library.create(basicAddition({ id: "q-mine" }));
		expect(Object.keys(stored().questions).sort()).toEqual(["q-external", "q-mine", "q-test0001"]);
		expect(library.has("q-external")).toBe(true);
	});

	it("recovers from the backup when a save stopped partway", async () => {
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second" }));
		files.failRenameTo = PATH;
		await expect(library.create(basicAddition({ id: "q-third" }))).rejects.toThrow("Rename failed");
		expect(files.files.has(PATH)).toBe(false);
		files.failRenameTo = null;
		const reloaded = await reload();
		expect(reloaded.definitions().map((definition) => definition.id).sort()).toEqual(["q-second", "q-test0001"]);
		await reloaded.create(basicAddition({ id: "q-fourth" }));
		expect(Object.keys(stored().questions).sort()).toEqual(["q-fourth", "q-second", "q-test0001"]);
	});

	it("refuses to load or save over a damaged file", async () => {
		files.files.set(PATH, "{ not json");
		await expect(library.load()).rejects.toThrow("damaged");
		await expect(library.create(basicAddition())).rejects.toThrow("damaged");
		expect(files.files.get(PATH)).toBe("{ not json");
	});

	it("refuses a file without the expected section", async () => {
		files.files.set(PATH, JSON.stringify({ version: 1, exams: {} }));
		await expect(library.load()).rejects.toThrow('no "questions" section');
	});

	it("refuses a file from a newer version", async () => {
		const content = JSON.stringify({ version: 99, questions: {} });
		files.files.set(PATH, content);
		await expect(library.create(basicAddition())).rejects.toThrow("newer version");
		expect(files.files.get(PATH)).toBe(content);
	});

	it("reports a bad item, loads the rest and keeps the bad item when saving", async () => {
		await library.create(basicAddition());
		const document = stored();
		document.questions["q-bad"] = { type: "mystery" };
		files.files.set(PATH, JSON.stringify(document));
		const reloaded = await reload();
		expect(reloaded.definitions()).toHaveLength(1);
		expect(reloaded.problems().map((problem) => problem.id)).toEqual(["q-bad"]);
		await reloaded.create(basicAddition({ id: "q-new" }));
		expect(stored().questions["q-bad"]).toEqual({ type: "mystery" });
	});

	it("notifies listeners until unsubscribed", async () => {
		let calls = 0;
		const unsubscribe = library.onChange(() => calls++);
		await library.create(basicAddition());
		expect(calls).toBe(1);
		unsubscribe();
		await library.delete("q-test0001");
		expect(calls).toBe(1);
	});

	it("keeps a prompt containing code fences, pipes and links exactly", async () => {
		const prompt = "```\n$|x|$ [[A link]] \"quoted\"\n```";
		await library.create(basicAddition({ prompt }));
		expect((await reload()).get("q-test0001")?.prompt).toBe(prompt);
	});

	it("round-trips multiple-choice and written flashcards", async () => {
		const choice = basicAddition({
			id: "q-choice",
			kind: "flashcard",
			variables: [],
			steps: [],
			answer: { check: "exact" },
			flashcard: { mode: "choice", answer: "", options: ["One", "Two"], correct: 1 },
		});
		const written = basicAddition({
			id: "q-written",
			kind: "flashcard",
			variables: [],
			steps: [],
			answer: { check: "exact" },
			flashcard: { ...blankFlashcard(), answer: "Newton" },
		});
		await library.create(choice);
		await library.create(written);
		const reloaded = await reload();
		expect(reloaded.get("q-choice")).toEqual(choice);
		expect(reloaded.get("q-written")).toEqual(written);
	});

	it("round-trips scientific notation and images", async () => {
		const question = basicAddition({ scientific: true, images: ["diagram.png"] });
		await library.create(question);
		expect((await reload()).get("q-test0001")).toEqual(question);
	});

	it("round-trips exams with every option", async () => {
		const format = { collection: "exams", parse: parseExamRecord, toRecord: examRecord };
		const exams = new JsonLibrary(files, format, "examiner/exams.json");
		const exam: ExamDefinition = {
			id: "e-1",
			title: "Mock",
			tags: ["maths"],
			timeLimitMinutes: 20,
			passingPercent: 55,
			questions: [{ questionId: "q-1", count: 2 }],
			attachments: ["sheet.pdf"],
			shuffle: true,
		};
		await exams.create(exam);
		await exams.create({ id: "e-2", title: "Untimed", tags: [], timeLimitMinutes: null, passingPercent: 50, questions: [] });
		const fresh = new JsonLibrary(files, format, "examiner/exams.json");
		await fresh.load();
		expect(fresh.get("e-1")).toEqual(exam);
		expect(fresh.get("e-2")?.timeLimitMinutes).toBeNull();
	});
});
