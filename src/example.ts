import { blankFlashcard, type QuestionDefinition } from "./core/definition";

export const EXAMPLE_TAG = "examiner-example";

export function withoutDefaultTags(tags: readonly string[]): string[] {
	return tags.filter((tag) => tag.toLowerCase() !== EXAMPLE_TAG);
}

export const EXAMPLE_QUESTION: QuestionDefinition = {
	id: "q-example1",
	kind: "calculation",
	title: "Basic addition",
	prompt: "What is {x} + {y}?",
	variables: [
		{ name: "x", source: { kind: "integer", min: 1, max: 10 } },
		{ name: "y", source: { kind: "integer", min: 1, max: 10 } },
	],
	steps: [{ target: "answer", expression: "{x} + {y}" }],
	answer: { check: "exact" },
	flashcard: blankFlashcard(),
	marks: 1,
	tags: [EXAMPLE_TAG],
};
