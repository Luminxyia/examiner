import { parseNumberInput } from "../core/numbers";
import { isValidAttachmentReference } from "./attachments";

export const KEYS = {
	kind: "examiner",
	version: "examiner-version",
	id: "examiner-id",
	title: "examiner-title",
	tags: "examiner-tags",
	variables: "examiner-variables",
	steps: "examiner-steps",
	answer: "examiner-answer",
	type: "examiner-type",
	marks: "examiner-marks",
	answerMode: "examiner-answer-mode",
	expectedAnswer: "examiner-expected-answer",
	options: "examiner-options",
	correctOption: "examiner-correct-option",
	scientific: "examiner-scientific-notation",
	attachments: "examiner-attachments",
	shuffle: "examiner-randomize-order",
	images: "examiner-images",
	timeLimit: "examiner-time-limit",
	passingGrade: "examiner-passing-grade",
	questions: "examiner-questions",
} as const;

export type FileKind = "question" | "exam";

export type ParseResult<T> = { ok: true; definition: T } | { ok: false; errors: string[] };

export function fileKindOf(frontmatter: Record<string, unknown> | undefined): FileKind | null {
	const kind = frontmatter?.[KEYS.kind];
	return kind === "question" || kind === "exam" ? kind : null;
}

export function readString(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") return String(value);
	return undefined;
}

export function readNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		const parsed = parseNumberInput(value);
		return parsed.ok ? parsed.value : undefined;
	}
	return undefined;
}

export function readFileNames(
	raw: unknown,
	key: string,
	errors: string[],
	accept: (name: string) => boolean = isValidAttachmentReference,
): string[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		errors.push(`"${key}" must be a list.`);
		return [];
	}
	const names = raw.map((entry: unknown) => readString(entry) ?? "");
	return [...new Set(names.filter((name) => isValidAttachmentReference(name) && accept(name)))];
}

export function readStringList(value: unknown, key: string, errors: string[]): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value.split(",");
	if (Array.isArray(value)) return value.map((item) => readString(item) ?? "").filter((item) => item !== "");
	errors.push(`"${key}" must be a list.`);
	return [];
}

export function createId(prefix: string): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return `${prefix}-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}
