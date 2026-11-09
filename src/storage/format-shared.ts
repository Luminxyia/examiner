import { parseNumberInput } from "../core/numbers";
import { isValidAttachmentReference } from "./attachments";

export type ParseResult<T> = { ok: true; definition: T } | { ok: false; errors: string[] };

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
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
