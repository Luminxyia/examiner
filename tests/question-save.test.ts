import { describe, expect, it } from "vitest";
import { questionSaveAction, type QuestionDefinition } from "../src/core/definition";
import { prepareExam } from "../src/core/exam";
import { createId } from "../src/storage/format-shared";
import { DefinitionLibrary } from "../src/storage/library";
import { parseQuestionFile, serializeQuestion } from "../src/storage/question-format";
import { FakeFolderFiles } from "./fake-files";
import { basicAddition, seededRandom } from "./helpers";

const FOLDER = "plugin/questions";

function questionLibrary(files: FakeFolderFiles): DefinitionLibrary<QuestionDefinition> {
	return new DefinitionLibrary(files, { kind: "question", parse: parseQuestionFile, serialize: serializeQuestion }, FOLDER);
}

async function saveLikeTheEditor(library: DefinitionLibrary<QuestionDefinition>, draft: QuestionDefinition): Promise<QuestionDefinition> {
	const definition = { ...structuredClone(draft), title: draft.title.trim() };
	const stored = library.get(definition.id) ?? null;
	const action = questionSaveAction(stored, definition.title);
	if (action === "copy") definition.id = createId("q");
	if (action === "update") await library.save(definition);
	else await library.create(definition);
	return library.get(definition.id) ?? definition;
}

describe("questionSaveAction", () => {
	it("creates questions that have not been saved yet", () => {
		expect(questionSaveAction(null, "Anything")).toBe("create");
	});

	it("updates when the title is unchanged, ignoring surrounding spaces", () => {
		expect(questionSaveAction({ title: "Ohm's law" }, "Ohm's law")).toBe("update");
		expect(questionSaveAction({ title: "Ohm's law" }, "  Ohm's law ")).toBe("update");
	});

	it("makes a copy when the title changes, including a change of case", () => {
		expect(questionSaveAction({ title: "Ohm's law" }, "Ohm's law (AC)")).toBe("copy");
		expect(questionSaveAction({ title: "Ohm's law" }, "ohm's law")).toBe("copy");
	});
});

describe("saving an edited question", () => {
	it("updates the original when the title is unchanged", async () => {
		const files = new FakeFolderFiles();
		const library = questionLibrary(files);
		const original = await saveLikeTheEditor(library, basicAddition({ id: "q-orig" }));
		await saveLikeTheEditor(library, { ...original, prompt: "What is {x} plus {y}?" });
		await saveLikeTheEditor(library, { ...original, marks: 3 });
		expect(library.definitions()).toHaveLength(1);
		expect(library.get("q-orig")).toMatchObject({ title: "Basic addition", marks: 3 });
		expect([...files.files.keys()]).toEqual([`${FOLDER}/q-orig.md`]);
	});

	it("saves a renamed question as a new question and leaves the original untouched", async () => {
		const files = new FakeFolderFiles();
		const library = questionLibrary(files);
		const original = await saveLikeTheEditor(library, basicAddition({ id: "q-orig" }));
		const originalFile = files.content(`${FOLDER}/q-orig.md`);

		const copy = await saveLikeTheEditor(library, { ...original, title: "Harder addition", prompt: "What is {x} + {y} + 1?" });

		expect(copy.id).not.toBe("q-orig");
		expect(copy).toMatchObject({ title: "Harder addition", prompt: "What is {x} + {y} + 1?" });
		expect(files.content(`${FOLDER}/q-orig.md`)).toBe(originalFile);
		expect(library.get("q-orig")).toMatchObject({ title: "Basic addition", prompt: "What is {x} + {y}?" });
		expect(library.definitions()).toHaveLength(2);
	});

	it("does not keep creating copies once the renamed question has been saved", async () => {
		const library = questionLibrary(new FakeFolderFiles());
		const original = await saveLikeTheEditor(library, basicAddition({ id: "q-orig" }));
		const copy = await saveLikeTheEditor(library, { ...original, title: "Renamed" });
		await saveLikeTheEditor(library, { ...copy, marks: 2 });
		await saveLikeTheEditor(library, { ...copy, marks: 4 });
		expect(library.definitions().map((question) => question.title).sort()).toEqual(["Basic addition", "Renamed"]);
		expect(library.get(copy.id)?.marks).toBe(4);
	});

	it("keeps exams pointing at the original question", async () => {
		const library = questionLibrary(new FakeFolderFiles());
		const original = await saveLikeTheEditor(library, basicAddition({ id: "q-orig" }));
		await saveLikeTheEditor(library, { ...original, title: "Renamed" });
		const { items, missing } = prepareExam(
			{ id: "e", title: "Exam", tags: [], timeLimitMinutes: null, passingPercent: 40, questions: [{ questionId: "q-orig", count: 1 }] },
			(id) => library.get(id),
			seededRandom(1),
		);
		expect(missing).toEqual([]);
		expect(items[0]).toMatchObject({ questionId: "q-orig", title: "Basic addition" });
	});
});
