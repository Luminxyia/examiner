import { beforeEach, describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../src/core/definition";
import type { ExamDefinition } from "../src/core/exam";
import { parseExamFile, serializeExam } from "../src/storage/exam-format";
import { splitFrontmatter } from "../src/storage/frontmatter";
import { DefinitionLibrary } from "../src/storage/library";
import { parseQuestionFile, serializeQuestion } from "../src/storage/question-format";
import { FakeFolderFiles } from "./fake-files";
import { basicAddition } from "./helpers";

const FOLDER = "plugin/questions";
const questionFormat = { kind: "question" as const, parse: parseQuestionFile, serialize: serializeQuestion };
const examFormat = { kind: "exam" as const, parse: parseExamFile, serialize: serializeExam };

describe("DefinitionLibrary", () => {
	let files: FakeFolderFiles;
	let library: DefinitionLibrary<QuestionDefinition>;

	beforeEach(() => {
		files = new FakeFolderFiles();
		library = new DefinitionLibrary(files, questionFormat, FOLDER);
	});

	const reload = async () => {
		const fresh = new DefinitionLibrary(files, questionFormat, FOLDER);
		await fresh.load();
		return fresh;
	};

	it("creates files named after the ID in its folder", async () => {
		const path = await library.create(basicAddition());
		expect(path).toBe(`${FOLDER}/q-test0001.md`);
		expect(files.folders.has(FOLDER)).toBe(true);
		expect(library.get("q-test0001")).toEqual(basicAddition());
		await expect(library.create(basicAddition())).rejects.toThrow("already exists");
	});

	it("loads definitions after a restart", async () => {
		await library.create(basicAddition());
		await library.create(basicAddition({ id: "q-second", title: "Another" }));
		const reloaded = await reload();
		expect(reloaded.definitions().map((definition) => definition.title)).toEqual(["Another", "Basic addition"]);
	});

	it("only reads its own folder", async () => {
		files.files.set("plugin/exams/e-1.md", serializeExam({ id: "e-1", title: "Exam", tags: [], timeLimitMinutes: null, passingPercent: 50, questions: [] }));
		files.files.set(`${FOLDER}/nested/q-x.md`, serializeQuestion(basicAddition({ id: "q-x" })));
		files.files.set(`${FOLDER}/notes.txt`, "not markdown");
		expect((await reload()).definitions()).toEqual([]);
	});

	it("updates a definition in place, keeping its file name when the title changes", async () => {
		const path = await library.create(basicAddition());
		expect(await library.save(basicAddition({ title: "Simple sums", prompt: "Add {x} and {y}." }))).toBe(path);
		expect(splitFrontmatter(files.content(path)).body).toBe("Add {x} and {y}.\n");
		expect((await reload()).get("q-test0001")?.title).toBe("Simple sums");
	});

	it("keeps properties added to the file by hand", async () => {
		const path = await library.create(basicAddition());
		files.files.set(path, files.content(path).replace("---\n", "---\nsource: textbook\n"));
		const reloaded = await reload();
		await reloaded.save(basicAddition({ title: "Changed" }));
		expect(files.content(path)).toContain("source: textbook");
	});

	it("deletes to the trash", async () => {
		const path = await library.create(basicAddition());
		await library.delete("q-test0001");
		expect(files.trashed).toEqual([path]);
		expect(library.get("q-test0001")).toBeUndefined();
		expect((await reload()).definitions()).toEqual([]);
	});

	it("reports files that cannot be used instead of failing", async () => {
		files.files.set(`${FOLDER}/broken.md`, "---\nexaminer: question\nexaminer-id: [broken\n---\n");
		files.files.set(`${FOLDER}/note.md`, "Just a note.");
		files.files.set(`${FOLDER}/exam.md`, serializeExam({ id: "e-1", title: "Exam", tags: [], timeLimitMinutes: null, passingPercent: 50, questions: [] }));
		await library.create(basicAddition());
		const reloaded = await reload();
		expect(reloaded.definitions()).toHaveLength(1);
		const problems = reloaded.problems();
		expect(problems.map((problem) => problem.path)).toEqual([`${FOLDER}/broken.md`, `${FOLDER}/exam.md`, `${FOLDER}/note.md`]);
		expect(problems[0]?.errors[0]).toContain("not valid YAML");
		expect(problems[1]?.errors[0]).toContain('needs "examiner: question"');
	});

	it("prefers the file named after an ID when two share it, and can give the copy a new ID", async () => {
		const original = await library.create(basicAddition());
		files.files.set(`${FOLDER}/a-copy.md`, files.content(original));
		const reloaded = await reload();
		expect(reloaded.pathOf("q-test0001")).toBe(original);
		expect(reloaded.problems()).toEqual([
			{ path: `${FOLDER}/a-copy.md`, errors: [`It has the same ID as ${original}, so it is ignored.`], duplicateOf: original },
		]);

		await reloaded.assignNewId(`${FOLDER}/a-copy.md`, "q-fresh");
		expect(reloaded.problems()).toEqual([]);
		expect(reloaded.pathOf("q-fresh")).toBe(`${FOLDER}/q-fresh.md`);
		expect(files.files.has(`${FOLDER}/a-copy.md`)).toBe(false);
		expect(reloaded.definitions().map((definition) => definition.id).sort()).toEqual(["q-fresh", "q-test0001"]);
	});

	it("imports files from elsewhere once, skipping IDs already in use and other kinds", async () => {
		const content = serializeQuestion(basicAddition());
		expect(await library.import(content)).toBe(true);
		expect(files.content(`${FOLDER}/q-test0001.md`)).toBe(content);
		expect(await library.import(content)).toBe(false);
		expect(await library.import("---\ntags: [x]\n---\nA note")).toBe(false);
		expect(await library.import(serializeExam({ id: "e-1", title: "Exam", tags: [], timeLimitMinutes: null, passingPercent: 50, questions: [] }))).toBe(false);
	});

	it("notifies listeners of changes", async () => {
		let calls = 0;
		const unsubscribe = library.onChange(() => calls++);
		await library.create(basicAddition());
		expect(calls).toBeGreaterThan(0);
		unsubscribe();
		const before = calls;
		await library.delete("q-test0001");
		expect(calls).toBe(before);
	});

	it("handles exams with the same machinery", async () => {
		const exams = new DefinitionLibrary(files, examFormat, "plugin/exams");
		const exam: ExamDefinition = { id: "e-1", title: "Mock", tags: [], timeLimitMinutes: 20, passingPercent: 50, questions: [] };
		await exams.create(exam);
		expect(exams.get("e-1")).toEqual(exam);
		expect(files.files.has("plugin/exams/e-1.md")).toBe(true);
	});
});
