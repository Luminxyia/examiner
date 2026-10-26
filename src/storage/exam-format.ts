import {
	LEGACY_PASSING_PERCENT,
	formatTimeLimit,
	isValidPassingPercent,
	parseTimeLimit,
	type ExamDefinition,
	type ExamQuestionRef,
} from "../core/exam";
import { normaliseTags } from "../core/tags";
import { composeFile, readFrontmatter, type Frontmatter } from "./frontmatter";
import { isSafeAttachmentName } from "./attachments";
import { KEYS, readNumber, readString, readStringList, type ParseResult } from "./format-shared";

export const EXAM_FORMAT_VERSION = 1;

export function parseExamFile(content: string): ParseResult<ExamDefinition> {
	const read = readFrontmatter(content);
	if (!read.ok) return { ok: false, errors: [read.error] };
	const data = read.data;
	const errors: string[] = [];

	const version = data[KEYS.version];
	if (version !== undefined && (typeof version !== "number" || version > EXAM_FORMAT_VERSION)) {
		return { ok: false, errors: [`This file uses format version ${JSON.stringify(version)}, which needs a newer version of Examiner.`] };
	}

	const id = readString(data[KEYS.id]);
	if (!id) errors.push(`Missing "${KEYS.id}".`);

	const timeLimitMinutes = parseTimeLimit(data[KEYS.timeLimit]);
	if (timeLimitMinutes === undefined) {
		errors.push(`"${KEYS.timeLimit}" must be a duration such as 30min or 1hr, or none.`);
	}

	const rawPassing = data[KEYS.passingGrade];
	const passingPercent =
		rawPassing === undefined || rawPassing === null
			? LEGACY_PASSING_PERCENT
			: readNumber(typeof rawPassing === "string" ? rawPassing.replace(/%\s*$/, "") : rawPassing);
	if (passingPercent === undefined || !isValidPassingPercent(passingPercent)) {
		errors.push(`"${KEYS.passingGrade}" must be a whole number from 0 to 100.`);
	}

	const questions = readQuestionRefs(data[KEYS.questions], errors);
	const tags = readStringList(data[KEYS.tags], KEYS.tags, errors);
	const attachments = readAttachments(data[KEYS.attachments], errors);

	if (errors.length > 0 || !id) return { ok: false, errors };
	return {
		ok: true,
		definition: {
			id,
			title: readString(data[KEYS.title]) ?? "",
			tags: normaliseTags(tags),
			timeLimitMinutes: timeLimitMinutes ?? null,
			passingPercent: passingPercent ?? LEGACY_PASSING_PERCENT,
			questions,
			...(attachments.length > 0 ? { attachments } : {}),
		},
	};
}

function readAttachments(raw: unknown, errors: string[]): string[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"${KEYS.attachments}" must be a list.`);
		return [];
	}
	const names = raw.map((entry: unknown) => readString(entry) ?? "");
	return [...new Set(names.filter(isSafeAttachmentName))];
}

export function serializeExam(exam: ExamDefinition, previousContent?: string): string {
	const previous = previousContent === undefined ? undefined : readFrontmatter(previousContent);
	const managed: Frontmatter = {
		[KEYS.kind]: "exam",
		[KEYS.version]: EXAM_FORMAT_VERSION,
		[KEYS.id]: exam.id,
		[KEYS.title]: exam.title,
		[KEYS.tags]: exam.tags,
		[KEYS.timeLimit]: exam.timeLimitMinutes === null ? "none" : formatTimeLimit(exam.timeLimitMinutes),
		[KEYS.passingGrade]: exam.passingPercent,
		[KEYS.questions]: exam.questions.map((ref) => ({ id: ref.questionId, count: ref.count })),
		[KEYS.attachments]: exam.attachments && exam.attachments.length > 0 ? exam.attachments : undefined,
	};
	const body = previous?.ok ? previous.body : "";
	return composeFile(managed, body, previous?.ok ? previous.data : {});
}

function readQuestionRefs(raw: unknown, errors: string[]): ExamQuestionRef[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"${KEYS.questions}" must be a list.`);
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
