import { describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../src/core/definition";
import { JsonLibrary } from "../src/storage/json-library";
import { LoadState } from "../src/storage/load-state";
import { parseQuestionRecord, questionRecord } from "../src/storage/question-format";
import { FakeDataFiles } from "./fake-files";
import { basicAddition } from "./helpers";

const PATH = "plugin/questions.json";
const format = { collection: "questions", parse: parseQuestionRecord, toRecord: questionRecord };

function questionLibrary(files = new FakeDataFiles()): JsonLibrary<QuestionDefinition> {
	return new JsonLibrary(files, format, PATH);
}

describe("LoadState", () => {
	it("starts out loading and tells listeners once it is ready", async () => {
		const state = new LoadState();
		const seen: boolean[] = [];
		state.onChange(() => seen.push(state.ready));
		expect(state.ready).toBe(false);
		expect(await state.run(() => Promise.resolve())).toBe(true);
		expect(state).toMatchObject({ ready: true, error: null, loading: false });
		expect(seen).toEqual([true]);
	});

	it("tells a view about readiness even when the library changed while it was still loading", async () => {
		const files = new FakeDataFiles();
		await questionLibrary(files).create(basicAddition());
		const library = questionLibrary(files);
		const state = new LoadState();
		const views: string[] = [];
		const show = () => views.push(state.ready ? `ready with ${library.definitions().length}` : "loading");
		library.onChange(show);
		state.onChange(show);

		await state.run(() => library.load());

		expect(views).toEqual(["loading", "ready with 1"]);
	});

	it("becomes ready with no saved questions", async () => {
		const library = questionLibrary();
		const state = new LoadState();
		await state.run(() => library.load());
		expect(state.ready).toBe(true);
		expect(library.definitions()).toEqual([]);
	});

	it("reports a failure instead of loading forever, and recovers on retry", async () => {
		const files = new FakeDataFiles();
		await questionLibrary(files).create(basicAddition());
		const library = questionLibrary(files);
		const read = files.read.bind(files);
		files.read = () => Promise.reject(new Error("Disk unavailable"));
		const state = new LoadState();
		const seen: string[] = [];
		state.onChange(() => seen.push(state.error ?? (state.ready ? "ready" : "loading")));

		expect(await state.run(() => library.load())).toBe(false);
		expect(state).toMatchObject({ ready: false, error: "Disk unavailable", loading: false });

		files.read = read;
		expect(await state.run(() => library.load())).toBe(true);
		expect(state).toMatchObject({ ready: true, error: null });
		expect(library.definitions()).toHaveLength(1);
		expect(seen).toEqual(["Disk unavailable", "loading", "ready"]);
	});

	it("shares one load between overlapping requests", async () => {
		const state = new LoadState();
		let calls = 0;
		let finish = () => {};
		const task = () => {
			calls++;
			return new Promise<void>((resolve) => (finish = resolve));
		};
		const first = state.run(task);
		const second = state.run(task);
		expect(state.loading).toBe(true);
		finish();
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(calls).toBe(1);
	});

	it("stops notifying listeners that unsubscribed", async () => {
		const state = new LoadState();
		let calls = 0;
		const unsubscribe = state.onChange(() => calls++);
		unsubscribe();
		await state.run(() => Promise.resolve());
		expect(calls).toBe(0);
	});
});
