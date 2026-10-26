import { answerInstruction, checkAnswer, formatExpectedAnswer } from "./answer";
import {
	DEFAULT_MARKS,
	hasErrors,
	validateDefinition,
	type AnswerRule,
	type FlashcardMode,
	type QuestionDefinition,
	type ValidationIssue,
} from "./definition";
import { awardedMarks, chosenOption, drawFlashcard, expectedFlashcardAnswer, type Judgement } from "./flashcard";
import { GenerationError, generateInstance, type QuestionInstance, type RandomSource, type StepResult } from "./generate";
import { parseNumberInput } from "./numbers";

export interface ExamQuestionRef {
	questionId: string;
	count: number;
}

export interface ExamDefinition {
	id: string;
	title: string;
	tags: string[];
	timeLimitMinutes: number | null;
	passingPercent: number;
	questions: ExamQuestionRef[];
}

interface ExamItemBase {
	questionId: string;
	title: string;
	tags: string[];
	marks?: number;
}

export interface CalculationItem extends ExamItemBase {
	kind?: "calculation";
	answerRule: AnswerRule;
	instance: QuestionInstance;
}

export interface FlashcardItem extends ExamItemBase {
	kind: "flashcard";
	prompt: string;
	mode: FlashcardMode;
	answer: string;
	options: string[];
	correct: number;
}

export type ExamItem = CalculationItem | FlashcardItem;

export function itemMarks(item: { marks?: number }): number {
	return item.marks ?? DEFAULT_MARKS;
}

export interface ExamPreparation {
	items: ExamItem[];
	missing: string[];
	unusable: { title: string; reason: string }[];
}

export function prepareExam(
	exam: ExamDefinition,
	findQuestion: (id: string) => QuestionDefinition | undefined,
	random: RandomSource = Math.random,
): ExamPreparation {
	const preparation: ExamPreparation = { items: [], missing: [], unusable: [] };
	for (const ref of exam.questions) {
		const definition = findQuestion(ref.questionId);
		if (!definition) {
			preparation.missing.push(ref.questionId);
			continue;
		}
		if (hasErrors(validateDefinition(definition))) {
			preparation.unusable.push({ title: definition.title, reason: "The question has validation errors." });
			continue;
		}
		const base = { questionId: definition.id, title: definition.title, tags: [...definition.tags], marks: definition.marks };
		if (definition.kind === "flashcard") {
			for (let i = 0; i < ref.count; i++) preparation.items.push({ ...base, kind: "flashcard", ...drawFlashcard(definition, random) });
			continue;
		}
		try {
			for (let i = 0; i < ref.count; i++) {
				preparation.items.push({ ...base, answerRule: definition.answer, instance: generateInstance(definition, random) });
			}
		} catch (error) {
			if (!(error instanceof GenerationError)) throw error;
			preparation.unusable.push({ title: definition.title, reason: error.message });
		}
	}
	return preparation;
}

export type ItemOutcome = "correct" | "partial" | "incorrect" | "unknown" | "unanswered";

export interface ExamItemResult {
	kind?: "flashcard";
	mode?: FlashcardMode;
	marks?: number;
	awarded?: number;
	questionId: string;
	title: string;
	tags: string[];
	prompt: string;
	instruction: string | null;
	inputs: Record<string, number>;
	steps: StepResult[];
	answer: number;
	expectedDisplay: string;
	response: string;
	outcome: ItemOutcome;
	note?: string;
}

export interface ScoreGroup {
	label: string;
	correct: number;
	total: number;
}

export interface ExamSummary {
	total: number;
	correct: number;
	partial?: number;
	marks?: number;
	maxMarks?: number;
	incorrect: number;
	unknown?: number;
	unanswered: number;
	percent: number;
	byQuestion: ScoreGroup[];
	byTag: ScoreGroup[];
}

export type Judgements = readonly (Judgement | null | undefined)[];

export function needsManualMarking(item: ExamItem, response: string | undefined, dontKnow: boolean | undefined): boolean {
	return item.kind === "flashcard" && item.mode === "written" && !dontKnow && (response ?? "").trim() !== "";
}

export function pendingMarking(items: readonly ExamItem[], responses: readonly string[], dontKnow: readonly boolean[] = []): number[] {
	return items.flatMap((item, index) => (needsManualMarking(item, responses[index], dontKnow[index]) ? [index] : []));
}

export class MarkingIncompleteError extends Error {
	constructor(readonly remaining: number) {
		super(`${remaining} written ${remaining === 1 ? "answer still needs" : "answers still need"} marking.`);
		this.name = "MarkingIncompleteError";
	}
}

export function markExam(
	items: readonly ExamItem[],
	responses: readonly string[],
	dontKnow: readonly boolean[] = [],
	judgements: Judgements = [],
): ExamItemResult[] {
	const remaining = pendingMarking(items, responses, dontKnow).filter((index) => !judgements[index]).length;
	if (remaining > 0) throw new MarkingIncompleteError(remaining);
	return items.map((item, index) => {
		const marks = itemMarks(item);
		const unknown = Boolean(dontKnow[index]);
		const response = unknown ? "" : (responses[index] ?? "").trim();
		const scored = <T extends { outcome: ItemOutcome }>(result: T): T & { marks: number; awarded: number } => ({
			...result,
			marks,
			awarded: result.outcome === "correct" ? marks : 0,
		});

		if (item.kind === "flashcard") {
			const base = {
				kind: "flashcard" as const,
				mode: item.mode,
				questionId: item.questionId,
				title: item.title,
				tags: item.tags,
				prompt: item.prompt,
				instruction: null,
				inputs: {},
				steps: [],
				answer: Number.NaN,
				expectedDisplay: expectedFlashcardAnswer(item),
				response,
			};
			if (unknown) return scored({ ...base, outcome: "unknown" });
			if (response === "") return scored({ ...base, outcome: "unanswered" });
			if (item.mode === "choice") {
				const chosen = chosenOption(response, item.options.length);
				if (chosen === null) return scored({ ...base, response: "", outcome: "unanswered" });
				return scored({ ...base, response: item.options[chosen] ?? "", outcome: chosen === item.correct ? "correct" : "incorrect" });
			}
			const judgement = judgements[index] ?? "incorrect";
			return { ...base, outcome: judgement, marks, awarded: awardedMarks(judgement, marks) };
		}

		const base = {
			questionId: item.questionId,
			title: item.title,
			tags: item.tags,
			prompt: item.instance.prompt,
			instruction: answerInstruction(item.answerRule),
			inputs: item.instance.inputs,
			steps: item.instance.steps,
			answer: item.instance.answer,
			expectedDisplay: formatExpectedAnswer(item.answerRule, item.instance.answer),
			response,
		};
		if (unknown) return scored({ ...base, outcome: "unknown" });
		if (response === "") return scored({ ...base, outcome: "unanswered" });
		const parsed = parseNumberInput(response);
		if (!parsed.ok) return scored({ ...base, outcome: "incorrect", note: parsed.message });
		const check = checkAnswer(item.answerRule, item.instance.answer, parsed.value);
		return scored({ ...base, outcome: check.correct ? "correct" : "incorrect", note: check.hint });
	});
}

export function summariseExam(results: readonly ExamItemResult[]): ExamSummary {
	const count = (outcome: ItemOutcome) => results.filter((result) => result.outcome === outcome).length;
	const marks = results.reduce((sum, result) => sum + earnedMarks(result), 0);
	const maxMarks = results.reduce((sum, result) => sum + itemMarks(result), 0);
	return {
		total: results.length,
		correct: count("correct"),
		partial: count("partial"),
		incorrect: count("incorrect"),
		unknown: count("unknown"),
		unanswered: count("unanswered"),
		marks,
		maxMarks,
		percent: maxMarks === 0 ? 0 : (marks / maxMarks) * 100,
		byQuestion: groupScores(results, (result) => [result.title], (_label, result) => result.questionId),
		byTag: groupScores(results, (result) => (result.tags.length > 0 ? result.tags : ["Untagged"]), (label) => label.toLowerCase())
			.sort((a, b) => b.correct / b.total - a.correct / a.total || a.label.localeCompare(b.label)),
	};
}

function earnedMarks(result: ExamItemResult): number {
	if (result.awarded !== undefined) return result.awarded;
	return result.outcome === "correct" ? itemMarks(result) : 0;
}

function groupScores(
	results: readonly ExamItemResult[],
	labelsOf: (result: ExamItemResult) => string[],
	keyOf: (label: string, result: ExamItemResult) => string,
): ScoreGroup[] {
	const groups = new Map<string, ScoreGroup>();
	for (const result of results) {
		for (const label of labelsOf(result)) {
			const key = keyOf(label, result);
			const group = groups.get(key) ?? { label, correct: 0, total: 0 };
			group.total += itemMarks(result);
			group.correct += earnedMarks(result);
			groups.set(key, group);
		}
	}
	return [...groups.values()];
}

export const TIME_LIMIT_PRESETS = [10, 20, 30, 45, 60, 90, 120, 180] as const;

export function formatTimeLimit(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest}min`;
	return rest === 0 ? `${hours}hr` : `${hours}hr ${rest}min`;
}

export function parseTimeLimit(raw: unknown): number | null | undefined {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : undefined;
	if (typeof raw !== "string") return undefined;
	const text = raw.trim().toLowerCase();
	if (text === "" || text === "none") return null;
	if (/^\d+$/.test(text)) return parseTimeLimit(Number(text));
	const match = /^(?:(\d+)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+)\s*(?:m|min|mins|minutes?))?$/.exec(text);
	if (!match || (match[1] === undefined && match[2] === undefined)) return undefined;
	const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
	return minutes > 0 ? minutes : undefined;
}

export const DEFAULT_PASSING_PERCENT = 40;

export const LEGACY_PASSING_PERCENT = 50;

export function isValidPassingPercent(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value <= 100;
}

export function validateExam(exam: ExamDefinition): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (exam.title.trim() === "") issues.push({ path: "title", severity: "error", message: "Give the exam a title." });
	if (exam.questions.length === 0) issues.push({ path: "questions", severity: "error", message: "Add at least one question." });
	if (!isValidPassingPercent(exam.passingPercent)) {
		issues.push({ path: "passingPercent", severity: "error", message: "The passing grade must be a whole number from 0 to 100." });
	}
	exam.questions.forEach((ref, index) => {
		if (!Number.isInteger(ref.count) || ref.count < 1) {
			issues.push({ path: `questions.${index}.count`, severity: "error", message: "Use a whole number of at least 1." });
		}
	});
	return issues;
}
