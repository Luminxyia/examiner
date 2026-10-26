import { ExpressionError, parseExpression, referencedVariables, VARIABLE_NAME_PATTERN } from "./expression";
import { hasAtMostPlaces } from "./numbers";
import { findTemplateReferences } from "./template";

export const ANSWER_VARIABLE = "answer";

export const MAX_DECIMAL_PLACES = 10;

export type VariableSource =
	| { kind: "integer"; min: number; max: number }
	| { kind: "decimal"; min: number; max: number; places: number }
	| { kind: "fixed"; value: number };

export type VariableKind = VariableSource["kind"];

export interface InputVariable {
	name: string;
	source: VariableSource;
}

export interface FormulaStep {
	target: string;
	expression: string;
}

export type AnswerRule =
	| { check: "exact" }
	| { check: "rounded"; places: number }
	| { check: "absolute"; tolerance: number }
	| { check: "relative"; percent: number };

export type QuestionKind = "calculation" | "flashcard";

export const QUESTION_KIND_NAMES: Record<QuestionKind, string> = {
	calculation: "Calculation",
	flashcard: "Flashcard",
};

export type FlashcardMode = "written" | "choice";

export interface Flashcard {
	mode: FlashcardMode;
	answer: string;
	options: string[];
	correct: number;
}

export const DEFAULT_MARKS = 1;

export const MAX_MARKS = 1000;

export interface QuestionDefinition {
	id: string;
	kind: QuestionKind;
	title: string;
	prompt: string;
	variables: InputVariable[];
	steps: FormulaStep[];
	answer: AnswerRule;
	flashcard: Flashcard;
	marks: number;
	scientific?: boolean;
	images?: string[];
	tags: string[];
}

export type QuestionSaveAction = "update" | "copy" | "create";

export function questionSaveAction(stored: Pick<QuestionDefinition, "title"> | null, title: string): QuestionSaveAction {
	if (!stored) return "create";
	return title.trim() === stored.title.trim() ? "update" : "copy";
}

export function blankFlashcard(): Flashcard {
	return { mode: "written", answer: "", options: ["", ""], correct: 0 };
}

export function isValidMarks(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= MAX_MARKS;
}

export interface ValidationIssue {
	path: string;
	severity: "error" | "warning";
	message: string;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

export function validateDefinition(definition: QuestionDefinition): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const error = (path: string, message: string) => issues.push({ path, severity: "error", message });
	const warning = (path: string, message: string) => issues.push({ path, severity: "warning", message });

	if (definition.title.trim() === "") error("title", "Give the question a title.");
	if (definition.prompt.trim() === "") error("prompt", "Write the question.");
	if (!isValidMarks(definition.marks)) error("marks", `Marks must be a whole number from 1 to ${MAX_MARKS}.`);

	if (definition.kind === "flashcard") {
		validateFlashcard(definition.flashcard, error);
		return issues;
	}

	const inputNames = new Set<string>();
	definition.variables.forEach((variable, index) => {
		const path = `variables.${index}`;
		const nameIssue = checkName(variable.name);
		if (nameIssue) error(`${path}.name`, nameIssue);
		else if (variable.name === ANSWER_VARIABLE) error(`${path}.name`, "{answer} is reserved and is always calculated by the steps.");
		else if (inputNames.has(variable.name)) error(`${path}.name`, `{${variable.name}} is already defined.`);
		inputNames.add(variable.name);
		validateSource(variable.source, path, error);
	});

	const stepOfTarget = new Map<string, number>();
	definition.steps.forEach((step, index) => {
		const nameIssue = checkName(step.target);
		if (nameIssue) return;
		if (!inputNames.has(step.target) && !stepOfTarget.has(step.target)) stepOfTarget.set(step.target, index);
	});

	const used = new Set<string>();
	if (definition.steps.length === 0) error("steps", "Add at least one step that calculates {answer}.");
	definition.steps.forEach((step, index) => {
		const path = `steps.${index}`;
		const nameIssue = checkName(step.target);
		if (nameIssue) error(`${path}.target`, nameIssue);
		else if (inputNames.has(step.target)) error(`${path}.target`, `{${step.target}} is an input variable and cannot be recalculated.`);
		else if (stepOfTarget.get(step.target) !== index) {
			error(`${path}.target`, `{${step.target}} is already calculated in step ${(stepOfTarget.get(step.target) ?? 0) + 1}.`);
		}

		let references: string[];
		try {
			references = referencedVariables(parseExpression(step.expression));
		} catch (cause) {
			if (!(cause instanceof ExpressionError)) throw cause;
			error(`${path}.expression`, describeExpressionError(cause, step.expression));
			return;
		}
		for (const name of references) {
			used.add(name);
			if (inputNames.has(name)) continue;
			const definedAt = stepOfTarget.get(name);
			if (definedAt === undefined) error(`${path}.expression`, `{${name}} is not defined.`);
			else if (definedAt === index) error(`${path}.expression`, `{${name}} cannot be used in its own calculation.`);
			else if (definedAt > index) {
				error(`${path}.expression`, `{${name}} is calculated later, in step ${definedAt + 1}. Move this step after it.`);
			}
		}
	});
	if (definition.steps.length > 0 && !stepOfTarget.has(ANSWER_VARIABLE)) {
		error("steps", "No step calculates {answer}. Set the target of the final step to answer.");
	}

	for (const reference of findTemplateReferences(definition.prompt)) {
		used.add(reference.name);
		if (reference.name === ANSWER_VARIABLE) {
			error("prompt", "The question shows {answer}, which would give the answer away.");
		} else if (!inputNames.has(reference.name) && !stepOfTarget.has(reference.name) && !reference.inMath) {
			error("prompt", `{${reference.name}} is not defined. Add it as a variable or calculate it in a step.`);
		}
	}

	definition.variables.forEach((variable, index) => {
		if (variable.name !== "" && !used.has(variable.name)) {
			warning(`variables.${index}.name`, `{${variable.name}} is not used in the question or any step.`);
		}
	});
	definition.steps.forEach((step, index) => {
		if (step.target !== ANSWER_VARIABLE && stepOfTarget.get(step.target) === index && !used.has(step.target)) {
			warning(`steps.${index}.target`, `{${step.target}} is calculated but never used.`);
		}
	});

	validateAnswerRule(definition.answer, error);
	return issues;
}

function checkName(name: string): string | null {
	if (name.trim() === "") return "Enter a variable name.";
	if (!VARIABLE_NAME_PATTERN.test(name)) {
		return "Use letters, digits and underscores only, starting with a letter or underscore.";
	}
	return null;
}

type Report = (path: string, message: string) => void;

function validateSource(source: VariableSource, path: string, error: Report): void {
	switch (source.kind) {
		case "integer":
			if (!Number.isSafeInteger(source.min)) error(`${path}.min`, "The minimum must be a whole number.");
			if (!Number.isSafeInteger(source.max)) error(`${path}.max`, "The maximum must be a whole number.");
			if (source.min > source.max) error(`${path}.max`, "The maximum must not be less than the minimum.");
			break;
		case "decimal": {
			const placesValid = Number.isInteger(source.places) && source.places >= 1 && source.places <= MAX_DECIMAL_PLACES;
			if (!placesValid) error(`${path}.places`, `Decimal places must be a whole number from 1 to ${MAX_DECIMAL_PLACES}.`);
			if (!Number.isFinite(source.min)) error(`${path}.min`, "The minimum must be a number.");
			else if (placesValid && !hasAtMostPlaces(source.min, source.places)) {
				error(`${path}.min`, `The minimum has more than ${source.places} decimal places.`);
			}
			if (!Number.isFinite(source.max)) error(`${path}.max`, "The maximum must be a number.");
			else if (placesValid && !hasAtMostPlaces(source.max, source.places)) {
				error(`${path}.max`, `The maximum has more than ${source.places} decimal places.`);
			}
			if (source.min > source.max) error(`${path}.max`, "The maximum must not be less than the minimum.");
			break;
		}
		case "fixed":
			if (!Number.isFinite(source.value)) error(`${path}.value`, "The value must be a number.");
			break;
	}
}

function validateFlashcard(card: Flashcard, error: Report): void {
	if (card.mode === "written") {
		if (card.answer.trim() === "") error("flashcard.answer", "Write the expected answer.");
		return;
	}
	if (card.options.length < 2) error("flashcard.options", "Add at least two options.");
	card.options.forEach((option, index) => {
		if (option.trim() === "") error(`flashcard.options.${index}`, "Write the option or remove it.");
	});
	if (!Number.isInteger(card.correct) || card.correct < 0 || card.correct >= card.options.length) {
		error("flashcard.options", "Choose the correct option.");
	}
}

function validateAnswerRule(rule: AnswerRule, error: Report): void {
	switch (rule.check) {
		case "exact":
			break;
		case "rounded":
			if (!Number.isInteger(rule.places) || rule.places < 0 || rule.places > MAX_DECIMAL_PLACES) {
				error("answer.places", `Decimal places must be a whole number from 0 to ${MAX_DECIMAL_PLACES}.`);
			}
			break;
		case "absolute":
			if (!Number.isFinite(rule.tolerance) || rule.tolerance <= 0) error("answer.tolerance", "The tolerance must be greater than 0.");
			break;
		case "relative":
			if (!Number.isFinite(rule.percent) || rule.percent <= 0 || rule.percent >= 100) {
				error("answer.tolerance", "The tolerance must be greater than 0% and less than 100%.");
			}
			break;
	}
}

export function describeExpressionError(error: ExpressionError, source: string): string {
	if (error.position === undefined || source.trim() === "") return error.message;
	return `${error.message} (at character ${error.position + 1})`;
}
