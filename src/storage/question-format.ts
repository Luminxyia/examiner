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
import { composeFile, readFrontmatter, type Frontmatter } from "./frontmatter";
import { attachmentKind } from "./attachments";
import { KEYS, readFileNames, readNumber, readString, readStringList, type ParseResult } from "./format-shared";

export const QUESTION_FORMAT_VERSION = 2;

const CALCULATION_FORMAT_VERSION = 1;

const STEP_PATTERN = /^\s*\{?\s*([^{}=\s]+)\s*\}?\s*=\s*([\s\S]*)$/;

export function parseQuestionFile(content: string): ParseResult<QuestionDefinition> {
	const read = readFrontmatter(content);
	if (!read.ok) return { ok: false, errors: [read.error] };
	const data = read.data;
	const errors: string[] = [];

	const version = data[KEYS.version];
	if (version !== undefined && (typeof version !== "number" || version > QUESTION_FORMAT_VERSION)) {
		return {
			ok: false,
			errors: [`This file uses format version ${JSON.stringify(version)}, which needs a newer version of Examiner.`],
		};
	}

	const id = readString(data[KEYS.id]);
	if (!id) errors.push(`Missing "${KEYS.id}".`);

	const kind = readKind(data[KEYS.type], errors);
	const rawMarks = data[KEYS.marks];
	const marks = rawMarks === undefined || rawMarks === null ? DEFAULT_MARKS : (readNumber(rawMarks) ?? Number.NaN);
	const flashcard = kind === "flashcard" ? readFlashcard(data, errors) : blankFlashcard();
	const variables = readVariables(data[KEYS.variables], errors);
	const steps = readSteps(data[KEYS.steps], errors);
	const answer = readAnswerRule(data[KEYS.answer], errors);
	const tags = readStringList(data[KEYS.tags], KEYS.tags, errors);
	const images = readFileNames(data[KEYS.images], KEYS.images, errors, (name) => attachmentKind(name) === "image");

	if (errors.length > 0 || !id) return { ok: false, errors };
	return {
		ok: true,
		definition: {
			id,
			kind,
			title: readString(data[KEYS.title]) ?? "",
			prompt: read.body.trim(),
			variables,
			steps,
			answer,
			flashcard,
			marks,
			...(data[KEYS.scientific] === true ? { scientific: true } : {}),
			...(images.length > 0 ? { images } : {}),
			tags: normaliseTags(tags),
		},
	};
}

export function serializeQuestion(definition: QuestionDefinition, previousContent?: string): string {
	const previous = previousContent === undefined ? undefined : readFrontmatter(previousContent);
	const isFlashcard = definition.kind === "flashcard";
	const isChoice = isFlashcard && definition.flashcard.mode === "choice";
	const managed: Frontmatter = {
		[KEYS.kind]: "question",
		[KEYS.version]: isFlashcard ? QUESTION_FORMAT_VERSION : CALCULATION_FORMAT_VERSION,
		[KEYS.id]: definition.id,
		[KEYS.type]: definition.kind,
		[KEYS.title]: definition.title,
		[KEYS.tags]: definition.tags,
		[KEYS.marks]: writeNumber(definition.marks),
		[KEYS.variables]: isFlashcard ? undefined : definition.variables.map(writeVariable),
		[KEYS.steps]: isFlashcard ? undefined : definition.steps.map((step) => `{${step.target}} = ${step.expression.trim()}`),
		[KEYS.answer]: isFlashcard ? undefined : writeAnswerRule(definition.answer),
		[KEYS.scientific]: !isFlashcard && definition.scientific ? true : undefined,
		[KEYS.images]: definition.images && definition.images.length > 0 ? definition.images : undefined,

		[KEYS.answerMode]: isFlashcard ? (isChoice ? "multiple-choice" : "written") : undefined,
		[KEYS.expectedAnswer]: isFlashcard && !isChoice ? definition.flashcard.answer.trim() : undefined,
		[KEYS.options]: isChoice ? definition.flashcard.options.map((option) => option.trim()) : undefined,
		[KEYS.correctOption]: isChoice ? writeNumber(definition.flashcard.correct + 1) : undefined,
	};
	return composeFile(managed, `${definition.prompt.trim()}\n`, previous?.ok ? previous.data : {});
}

function readKind(raw: unknown, errors: string[]): QuestionKind {
	if (raw === undefined || raw === null || raw === "calculation") return "calculation";
	if (raw === "flashcard") return "flashcard";
	errors.push(`Unknown question type ${JSON.stringify(raw)}. Use calculation or flashcard.`);
	return "calculation";
}

function readFlashcard(data: Frontmatter, errors: string[]): Flashcard {
	const card = blankFlashcard();
	const mode = data[KEYS.answerMode] ?? "written";
	if (mode === "multiple-choice") card.mode = "choice";
	else if (mode !== "written") errors.push(`Unknown answer mode ${JSON.stringify(mode)}. Use written or multiple-choice.`);
	card.answer = readString(data[KEYS.expectedAnswer]) ?? "";
	if (card.mode === "choice") {
		const options = data[KEYS.options];
		if (Array.isArray(options)) card.options = options.map((option) => readString(option) ?? "");
		else {
			card.options = [];
			if (options !== undefined && options !== null) errors.push(`"${KEYS.options}" must be a list.`);
		}
		const correct = readNumber(data[KEYS.correctOption]);
		card.correct = correct === undefined ? -1 : correct - 1;
	}
	return card;
}

function readVariables(raw: unknown, errors: string[]): InputVariable[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"${KEYS.variables}" must be a list.`);
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

function writeVariable(variable: InputVariable): Frontmatter {
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
		errors.push(`"${KEYS.steps}" must be a list.`);
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
		errors.push(`"${KEYS.answer}" must be a set of properties, such as { check: rounded, places: 2 }.`);
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

function writeAnswerRule(rule: AnswerRule): Frontmatter {
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
