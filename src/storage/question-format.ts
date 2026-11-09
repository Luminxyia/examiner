import {
	blankFlashcard,
	DEFAULT_MARKS,
	type AnswerRule,
	type Flashcard,
	type FormulaStep,
	type InputVariable,
	type QuestionDefinition,
	type QuestionKind,
	type VariableSource,
} from "../core/definition";
import { normaliseTags } from "../core/tags";
import { attachmentKind } from "./attachments";
import { asRecord, readFileNames, readNumber, readString, readStringList, type ParseResult } from "./format-shared";

const STEP_PATTERN = /^\s*\{?\s*([^{}=\s]+)\s*\}?\s*=\s*([\s\S]*)$/;

export function parseQuestionRecord(id: string, value: unknown): ParseResult<QuestionDefinition> {
	const fields = asRecord(value);
	if (fields === null) {
		return { ok: false, errors: ["The question must be a set of properties."] };
	}
	const errors: string[] = [];

	const kind = readKind(fields.type, errors);
	const rawMarks = fields.marks;
	const marks = rawMarks === undefined || rawMarks === null ? DEFAULT_MARKS : (readNumber(rawMarks) ?? Number.NaN);
	const flashcard = kind === "flashcard" ? readFlashcard(fields, errors) : blankFlashcard();
	const variables = readVariables(fields.variables, errors);
	const steps = readSteps(fields.steps, errors);
	const answer = readAnswerRule(fields.answer, errors);
	const tags = readStringList(fields.tags, "tags", errors);
	const images = readFileNames(fields.images, "images", errors, (name) => attachmentKind(name) === "image");

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		definition: {
			id,
			kind,
			title: readString(fields.title) ?? "",
			prompt: readString(fields.prompt) ?? "",
			variables,
			steps,
			answer,
			flashcard,
			marks,
			...(fields.scientific === true ? { scientific: true } : {}),
			...(images.length > 0 ? { images } : {}),
			tags: normaliseTags(tags),
		},
	};
}

export function questionRecord(definition: QuestionDefinition): Record<string, unknown> {
	const isFlashcard = definition.kind === "flashcard";
	const isChoice = isFlashcard && definition.flashcard.mode === "choice";
	const record: Record<string, unknown> = {
		type: definition.kind,
		title: definition.title,
		tags: definition.tags,
		marks: writeNumber(definition.marks),
		prompt: definition.prompt.trim(),
	};
	if (isFlashcard) {
		record.answerMode = isChoice ? "multiple-choice" : "written";
	} else {
		record.variables = definition.variables.map(writeVariable);
		record.steps = definition.steps.map((step) => `{${step.target}} = ${step.expression.trim()}`);
		record.answer = writeAnswerRule(definition.answer);
	}
	if (isFlashcard && !isChoice) {
		record.expectedAnswer = definition.flashcard.answer.trim();
	}
	if (isChoice) {
		record.options = definition.flashcard.options.map((option) => option.trim());
		record.correctOption = writeNumber(definition.flashcard.correct + 1);
	}
	if (!isFlashcard && definition.scientific) {
		record.scientific = true;
	}
	if (definition.images && definition.images.length > 0) {
		record.images = definition.images;
	}
	return record;
}

function readKind(raw: unknown, errors: string[]): QuestionKind {
	if (raw === undefined || raw === null || raw === "calculation") return "calculation";
	if (raw === "flashcard") return "flashcard";
	errors.push(`Unknown question type ${JSON.stringify(raw)}. Use calculation or flashcard.`);
	return "calculation";
}

function readFlashcard(fields: Record<string, unknown>, errors: string[]): Flashcard {
	const card = blankFlashcard();
	const mode = fields.answerMode ?? "written";
	if (mode === "multiple-choice") card.mode = "choice";
	else if (mode !== "written") errors.push(`Unknown answer mode ${JSON.stringify(mode)}. Use written or multiple-choice.`);
	card.answer = readString(fields.expectedAnswer) ?? "";
	if (card.mode === "choice") {
		const options = fields.options;
		if (Array.isArray(options)) card.options = options.map((option) => readString(option) ?? "");
		else {
			card.options = [];
			if (options !== undefined && options !== null) errors.push(`"options" must be a list.`);
		}
		const correct = readNumber(fields.correctOption);
		card.correct = correct === undefined ? -1 : correct - 1;
	}
	return card;
}

function readVariables(raw: unknown, errors: string[]): InputVariable[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"variables" must be a list.`);
		return [];
	}
	const variables: InputVariable[] = [];
	raw.forEach((entry: unknown, index) => {
		const label = `Variable ${index + 1}`;
		if (typeof entry !== "object" || entry === null) {
			errors.push(`${label} must have a name and a type.`);
			return;
		}
		const fields = entry as Record<string, unknown>;
		const name = readString(fields.name) ?? "";
		const source = readSource(fields, `${label}${name ? ` ({${name}})` : ""}`, errors);
		if (source) variables.push({ name, source });
	});
	return variables;
}

function readSource(fields: Record<string, unknown>, label: string, errors: string[]): VariableSource | null {
	const number = (key: string): number => readNumber(fields[key]) ?? Number.NaN;
	switch (fields.type) {
		case "integer":
			return { kind: "integer", min: number("min"), max: number("max") };
		case "decimal":
			return { kind: "decimal", min: number("min"), max: number("max"), places: number("places") };
		case "fixed":
			return { kind: "fixed", value: number("value") };
		default:
			errors.push(`${label} has an unknown type "${String(fields.type)}". Use integer, decimal or fixed.`);
			return null;
	}
}

function writeNumber(value: number): number | null {
	return Number.isFinite(value) ? value : null;
}

function writeVariable(variable: InputVariable): Record<string, unknown> {
	const { source } = variable;
	const name = variable.name;
	switch (source.kind) {
		case "integer":
			return { name, type: "integer", min: writeNumber(source.min), max: writeNumber(source.max) };
		case "decimal":
			return { name, type: "decimal", min: writeNumber(source.min), max: writeNumber(source.max), places: writeNumber(source.places) };
		case "fixed":
			return { name, type: "fixed", value: writeNumber(source.value) };
	}
}

function readSteps(raw: unknown, errors: string[]): FormulaStep[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"steps" must be a list.`);
		return [];
	}
	const steps: FormulaStep[] = [];
	raw.forEach((entry: unknown, index) => {
		const match = typeof entry === "string" ? STEP_PATTERN.exec(entry) : null;
		if (!match) {
			errors.push(`Step ${index + 1} must look like "{name} = expression". Quote it if it starts with a brace.`);
			return;
		}
		steps.push({ target: match[1] ?? "", expression: (match[2] ?? "").trim() });
	});
	return steps;
}

function readAnswerRule(raw: unknown, errors: string[]): AnswerRule {
	if (raw === undefined || raw === null) return { check: "exact" };
	if (typeof raw !== "object" || Array.isArray(raw)) {
		errors.push(`"answer" must be a set of properties, such as { check: rounded, places: 2 }.`);
		return { check: "exact" };
	}
	const fields = raw as Record<string, unknown>;
	const number = (key: string): number => readNumber(fields[key]) ?? Number.NaN;
	switch (fields.check ?? "exact") {
		case "exact":
			return { check: "exact" };
		case "rounded":
			return { check: "rounded", places: number("places") };
		case "absolute":
			return { check: "absolute", tolerance: number("tolerance") };
		case "relative":
			return { check: "relative", percent: number("percent") };
		default:
			errors.push(`Unknown answer check "${String(fields.check)}". Use exact, rounded, absolute or relative.`);
			return { check: "exact" };
	}
}

function writeAnswerRule(rule: AnswerRule): Record<string, unknown> {
	switch (rule.check) {
		case "exact":
			return { check: "exact" };
		case "rounded":
			return { check: "rounded", places: writeNumber(rule.places) };
		case "absolute":
			return { check: "absolute", tolerance: writeNumber(rule.tolerance) };
		case "relative":
			return { check: "relative", percent: writeNumber(rule.percent) };
	}
}
