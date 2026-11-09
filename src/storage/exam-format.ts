import {
	LEGACY_PASSING_PERCENT,
	formatTimeLimit,
	isValidPassingPercent,
	parseTimeLimit,
	type ExamDefinition,
	type ExamQuestionRef,
} from "../core/exam";
import { normaliseTags } from "../core/tags";
import { asRecord, readFileNames, readNumber, readString, readStringList, type ParseResult } from "./format-shared";

export function parseExamRecord(id: string, value: unknown): ParseResult<ExamDefinition> {
	const fields = asRecord(value);
	if (fields === null) {
		return { ok: false, errors: ["The exam must be a set of properties."] };
	}
	const errors: string[] = [];

	const timeLimitMinutes = parseTimeLimit(fields.timeLimit);
	if (timeLimitMinutes === undefined) {
		errors.push(`"timeLimit" must be a duration such as 30min or 1hr, or none.`);
	}

	const rawPassing = fields.passingGrade;
	const passingPercent =
		rawPassing === undefined || rawPassing === null
			? LEGACY_PASSING_PERCENT
			: readNumber(typeof rawPassing === "string" ? rawPassing.replace(/%\s*$/, "") : rawPassing);
	if (passingPercent === undefined || !isValidPassingPercent(passingPercent)) {
		errors.push(`"passingGrade" must be a whole number from 0 to 100.`);
	}

	const questions = readQuestionRefs(fields.questions, errors);
	const tags = readStringList(fields.tags, "tags", errors);
	const attachments = readFileNames(fields.attachments, "attachments", errors);

	let formulaSheet = "";
	if (typeof fields.formulaSheet === "string" && fields.formulaSheet.trim() !== "") {
		formulaSheet = fields.formulaSheet;
	}

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		definition: {
			id,
			title: readString(fields.title) ?? "",
			tags: normaliseTags(tags),
			timeLimitMinutes: timeLimitMinutes ?? null,
			passingPercent: passingPercent ?? LEGACY_PASSING_PERCENT,
			questions,
			...(attachments.length > 0 ? { attachments } : {}),
			...(formulaSheet !== "" ? { formulaSheet } : {}),
			...(fields.shuffle === true ? { shuffle: true } : {}),
		},
	};
}

export function examRecord(exam: ExamDefinition): Record<string, unknown> {
	const record: Record<string, unknown> = {
		title: exam.title,
		tags: exam.tags,
		timeLimit: exam.timeLimitMinutes === null ? "none" : formatTimeLimit(exam.timeLimitMinutes),
		passingGrade: exam.passingPercent,
		questions: exam.questions.map((ref) => ({ id: ref.questionId, count: ref.count })),
	};
	if (exam.attachments && exam.attachments.length > 0) {
		record.attachments = exam.attachments;
	}
	if (exam.formulaSheet && exam.formulaSheet.trim() !== "") {
		record.formulaSheet = exam.formulaSheet;
	}
	if (exam.shuffle) {
		record.shuffle = true;
	}
	return record;
}

function readQuestionRefs(raw: unknown, errors: string[]): ExamQuestionRef[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"questions" must be a list.`);
		return [];
	}
	const refs: ExamQuestionRef[] = [];
	raw.forEach((entry: unknown, index) => {
		const fields = typeof entry === "string" ? { id: entry } : entry;
		if (typeof fields !== "object" || fields === null) {
			errors.push(`Question ${index + 1} must have an id.`);
			return;
		}
		const { id, count } = fields as Record<string, unknown>;
		const questionId = readString(id);
		const parsedCount = count === undefined ? 1 : readNumber(count);
		if (!questionId) errors.push(`Question ${index + 1} must have an id.`);
		else if (parsedCount === undefined || !Number.isInteger(parsedCount) || parsedCount < 1) {
			errors.push(`Question ${index + 1} needs a count of at least 1.`);
		} else refs.push({ questionId, count: parsedCount });
	});
	return refs;
}
