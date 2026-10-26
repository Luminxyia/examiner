export type AttachmentKind = "pdf" | "image";

const KINDS: Record<string, AttachmentKind> = {
	pdf: "pdf",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
	svg: "image",
};

const MIME_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	svg: "image/svg+xml",
};

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class AttachmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AttachmentError";
	}
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function attachmentKind(name: string): AttachmentKind | null {
	return KINDS[extensionOf(name)] ?? null;
}

export function attachmentMimeType(name: string): string {
	return MIME_TYPES[extensionOf(name)] ?? "application/octet-stream";
}

export function isSafeAttachmentName(name: string): boolean {
	return name.trim() !== "" && !/[\\/]/.test(name) && name !== "." && name !== ".." && attachmentKind(name) !== null;
}

export function sanitiseFileName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? "";
	const cleaned = Array.from(base, (char) => (char.charCodeAt(0) < 32 ? "-" : char))
		.join("")
		.replace(/[:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
	return cleaned === "" ? "attachment" : cleaned;
}

export interface BinaryFiles {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	readBinary(path: string): Promise<ArrayBuffer>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
}

export class AttachmentStore {
	constructor(
		private readonly files: BinaryFiles,
		readonly folder: string,
	) {}

	private examFolder(examId: string): string {
		return `${this.folder}/${examId}`;
	}

	path(examId: string, name: string): string {
		if (!isSafeAttachmentName(name)) throw new AttachmentError(`"${name}" is not a valid attachment name.`);
		return `${this.examFolder(examId)}/${name}`;
	}

	async add(examId: string, fileName: string, data: ArrayBuffer, taken: readonly string[]): Promise<string> {
		const cleaned = sanitiseFileName(fileName);
		if (attachmentKind(cleaned) === null) throw new AttachmentError(`${cleaned} is not a PDF or an image.`);
		if (data.byteLength === 0) throw new AttachmentError(`${cleaned} is empty.`);
		if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${cleaned} is larger than 25 MB.`);
		const name = await this.uniqueName(examId, cleaned, taken);
		if (!(await this.files.exists(this.folder))) await this.files.mkdir(this.folder);
		if (!(await this.files.exists(this.examFolder(examId)))) await this.files.mkdir(this.examFolder(examId));
		await this.files.writeBinary(this.path(examId, name), data);
		return name;
	}

	async read(examId: string, name: string): Promise<ArrayBuffer> {
		return this.files.readBinary(this.path(examId, name));
	}

	async prune(examId: string, keep: readonly string[]): Promise<void> {
		const folder = this.examFolder(examId);
		if (!(await this.files.exists(folder))) return;
		const kept = new Set(keep);
		const listed = await this.files.list(folder);
		let remaining = listed.folders.length;
		for (const file of listed.files) {
			const name = file.split("/").pop() ?? "";
			if (kept.has(name)) remaining++;
			else await this.files.remove(file);
		}
		if (remaining === 0) await this.files.rmdir(folder, false);
	}

	async removeExam(examId: string): Promise<void> {
		const folder = this.examFolder(examId);
		if (await this.files.exists(folder)) await this.files.rmdir(folder, true);
	}

	async clear(): Promise<void> {
		if (await this.files.exists(this.folder)) await this.files.rmdir(this.folder, true);
	}

	private async uniqueName(examId: string, name: string, taken: readonly string[]): Promise<string> {
		const dot = name.lastIndexOf(".");
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : "";
		const used = new Set(taken.map((entry) => entry.toLowerCase()));
		for (let index = 1; ; index++) {
			const candidate = index === 1 ? name : `${stem} (${index})${extension}`;
			if (used.has(candidate.toLowerCase())) continue;
			if (await this.files.exists(`${this.examFolder(examId)}/${candidate}`)) continue;
			return candidate;
		}
	}
}
