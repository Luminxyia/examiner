import { describe, expect, it } from "vitest";
import type { ExamDefinition } from "../src/core/exam";
import {
	AttachmentError,
	AttachmentStore,
	MAX_ATTACHMENT_BYTES,
	attachmentKind,
	isSafeAttachmentName,
	sanitiseFileName,
	type BinaryFiles,
} from "../src/storage/attachments";
import { parseExamFile, serializeExam } from "../src/storage/exam-format";

class FakeBinaryFiles implements BinaryFiles {
	readonly files = new Map<string, ArrayBuffer>();
	readonly folders = new Set<string>();

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path) || this.folders.has(path));
	}

	mkdir(path: string): Promise<void> {
		this.folders.add(path);
		return Promise.resolve();
	}

	writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}

	readBinary(path: string): Promise<ArrayBuffer> {
		const data = this.files.get(path);
		return data ? Promise.resolve(data) : Promise.reject(new Error(`No file at ${path}`));
	}

	list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const inside = (entry: string) => entry.startsWith(`${path}/`) && !entry.slice(path.length + 1).includes("/");
		return Promise.resolve({ files: [...this.files.keys()].filter(inside), folders: [...this.folders].filter(inside) });
	}

	remove(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}

	rmdir(path: string, recursive: boolean): Promise<void> {
		const nested = [...this.files.keys(), ...this.folders].filter((entry) => entry.startsWith(`${path}/`));
		if (nested.length > 0 && !recursive) return Promise.reject(new Error("Folder is not empty"));
		for (const entry of nested) {
			this.files.delete(entry);
			this.folders.delete(entry);
		}
		this.folders.delete(path);
		return Promise.resolve();
	}
}

const bytes = (size = 4) => new Uint8Array(size).fill(7).buffer;
const FOLDER = "plugin/attachments";

describe("attachment names", () => {
	it("recognises PDFs and images only", () => {
		expect(attachmentKind("Formula sheet.PDF")).toBe("pdf");
		expect(attachmentKind("diagram.jpeg")).toBe("image");
		expect(attachmentKind("notes.docx")).toBeNull();
		expect(attachmentKind("no-extension")).toBeNull();
	});

	it("never lets a name escape the exam's folder", () => {
		expect(sanitiseFileName("../../secret/sheet.pdf")).toBe("sheet.pdf");
		expect(sanitiseFileName("C:\\Users\\me\\sheet?.png")).toBe("sheet-.png");
		expect(sanitiseFileName("...hidden.png")).toBe("hidden.png");
		expect(isSafeAttachmentName("../sheet.pdf")).toBe(false);
		expect(isSafeAttachmentName("sheet.pdf")).toBe(true);
		expect(isSafeAttachmentName("sheet.exe")).toBe(false);
	});
});

describe("AttachmentStore", () => {
	it("stores files inside the exam's folder and reads them back", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, FOLDER);
		const name = await store.add("e-1", "Formula sheet.pdf", bytes(), []);
		expect(name).toBe("Formula sheet.pdf");
		expect([...files.files.keys()]).toEqual([`${FOLDER}/e-1/Formula sheet.pdf`]);
		expect(new Uint8Array(await store.read("e-1", name))).toEqual(new Uint8Array(bytes()));
	});

	it("gives clashing names a number instead of overwriting", async () => {
		const store = new AttachmentStore(new FakeBinaryFiles(), FOLDER);
		const first = await store.add("e-1", "sheet.png", bytes(), []);
		const second = await store.add("e-1", "Sheet.png", bytes(), [first]);
		expect(second).toBe("Sheet (2).png");
	});

	it("rejects unsupported, empty and oversized files", async () => {
		const store = new AttachmentStore(new FakeBinaryFiles(), FOLDER);
		await expect(store.add("e-1", "notes.docx", bytes(), [])).rejects.toThrow(AttachmentError);
		await expect(store.add("e-1", "blank.pdf", new ArrayBuffer(0), [])).rejects.toThrow("is empty");
		await expect(store.add("e-1", "huge.pdf", new ArrayBuffer(MAX_ATTACHMENT_BYTES + 1), [])).rejects.toThrow("25 MB");
		await expect(store.read("e-1", "../escape.pdf")).rejects.toThrow(AttachmentError);
	});

	it("removes files that are no longer attached, and the folder once empty", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, FOLDER);
		const keep = await store.add("e-1", "keep.pdf", bytes(), []);
		const drop = await store.add("e-1", "drop.png", bytes(), [keep]);
		await store.prune("e-1", [keep]);
		expect([...files.files.keys()]).toEqual([`${FOLDER}/e-1/${keep}`]);
		expect(drop).toBe("drop.png");
		await store.prune("e-1", []);
		expect(files.files.size).toBe(0);
		expect(files.folders.has(`${FOLDER}/e-1`)).toBe(false);
	});

	it("deletes one exam's files or everything", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, FOLDER);
		await store.add("e-1", "a.pdf", bytes(), []);
		await store.add("e-2", "b.pdf", bytes(), []);
		await store.removeExam("e-1");
		expect([...files.files.keys()]).toEqual([`${FOLDER}/e-2/b.pdf`]);
		await store.clear();
		expect(files.files.size).toBe(0);
	});
});

describe("exam file attachments", () => {
	const exam: ExamDefinition = {
		id: "e-ref",
		title: "With sheet",
		tags: [],
		timeLimitMinutes: null,
		passingPercent: 40,
		questions: [{ questionId: "q-1", count: 1 }],
		attachments: ["Formula sheet.pdf", "circuit.png"],
	};

	it("keeps attached file names when an exam is saved and reopened", () => {
		const result = parseExamFile(serializeExam(exam));
		expect(result.ok && result.definition.attachments).toEqual(exam.attachments);
	});

	it("leaves older exams without attachments unchanged", () => {
		const { attachments: _attachments, ...plain } = exam;
		const content = serializeExam(plain);
		expect(content).not.toContain("examiner-attachments");
		const result = parseExamFile(content);
		expect(result.ok && "attachments" in result.definition).toBe(false);
	});

	it("skips unsafe or unsupported names instead of rejecting the exam", () => {
		const result = parseExamFile(
			"---\nexaminer: exam\nexaminer-id: e\nexaminer-attachments:\n  - ok.pdf\n  - ../evil.pdf\n  - virus.exe\n  - ok.pdf\n---\n",
		);
		expect(result.ok && result.definition.attachments).toEqual(["ok.pdf"]);
	});
});
