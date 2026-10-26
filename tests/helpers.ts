import { blankFlashcard, type QuestionDefinition } from "../src/core/definition";
import type { ExamItemResult, ItemOutcome } from "../src/core/exam";
import type { RandomSource } from "../src/core/generate";
import type { InsightAttempt } from "../src/core/insights";

export { seededRandom } from "../src/core/random";

export function sequence(...values: number[]): RandomSource {
	let index = 0;
	return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

export function basicAddition(overrides: Partial<QuestionDefinition> = {}): QuestionDefinition {
	return {
		id: "q-test0001",
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
		tags: ["mathematics"],
		...overrides,
	};
}

export const NOW = new Date(Date.UTC(2026, 9, 25, 12));

export const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

export function item(questionId: string, outcome: ItemOutcome, tags: string[] = [], title = questionId): ExamItemResult {
	return {
		questionId,
		title,
		tags,
		prompt: `Prompt for ${questionId}`,
		instruction: null,
		inputs: {},
		steps: [],
		answer: 1,
		expectedDisplay: "1",
		response: outcome === "unanswered" ? "" : "2",
		outcome,
		marks: 1,
		awarded: outcome === "correct" ? 1 : outcome === "partial" ? 0.5 : 0,
	};
}

export function attemptOf(id: string, examId: string, days: number, items: ExamItemResult[], examTitle = examId): InsightAttempt {
	return { id, examId, examTitle, submittedAt: daysAgo(days), items };
}
