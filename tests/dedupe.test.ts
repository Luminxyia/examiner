import { beforeEach, describe, expect, it } from "vitest";
import {
	AttachmentStore,
	attachmentLabel,
	findIdenticalFile,
	isValidAttachmentReference,
	renameVaultReferences,
	sameBytes,
	vaultReference,
} from "../src/storage/attachments";
import { parseExamFile, serializeExam } from "../src/storage/exam-format";
import { parseQuestionFile, serializeQuestion } from "../src/storage/question-format";
import type { VaultFiles } from "../src/storage/vault-files";
import { addAttachments, type AttachmentAccess } from "../src/ui/attachment-picker";
import { FakeBinaryFiles } from "./fake-files";
import { basicAddition } from "./helpers";
import { notices } from "./obsidian-stub";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

class FakeVault {
	readonly files = new Map<string, ArrayBuffer>();
	readonly reads: string[] = [];

	candidates() {
		return [...this.files].map(([path, data]) => ({ path, size: data.byteLength }));
	}

	read(path: string): Promise<ArrayBuffer> {
		this.reads.push(path);
		const data = this.files.get(path);
		return data ? Promise.resolve(data) : Promise.reject(new Error("missing"));
	}

	resourcePath(path: string): string | null {
		return this.files.has(path) ? `app://vault/${path}` : null;
	}
}

describe("vault references", () => {
	it("accepts safe vault paths and rejects unsafe ones", () => {
		expect(isValidAttachmentReference("vault:Images/circuit.png")).toBe(true);
		expect(isValidAttachmentReference("vault:Formula sheet.pdf")).toBe(true);
		for (const reference of ["vault:../escape.png", "vault:/absolute.png", "vault:a/../b.png", "vault:a//b.png", "vault:notes.md", "vault:"]) {
			expect(isValidAttachmentReference(reference)).toBe(false);
		}
		expect(isValidAttachmentReference("sheet.pdf")).toBe(true);
	});

	it("shows vault references by their path", () => {
		expect(attachmentLabel("vault:Images/circuit.png")).toBe("Images/circuit.png");
		expect(attachmentLabel("circuit.png")).toBe("circuit.png");
	});

	it("follows renamed files and folders without touching other references", () => {
		const references = ["vault:Images/circuit.png", "vault:Images/old/graph.png", "local.png", "vault:Other/x.png"];
		expect(renameVaultReferences(references, "Images/circuit.png", "Physics/circuit.png")).toEqual([
			"vault:Physics/circuit.png",
			"vault:Images/old/graph.png",
			"local.png",
			"vault:Other/x.png",
		]);
		expect(renameVaultReferences(references, "Images", "Pictures")).toEqual([
			"vault:Pictures/circuit.png",
			"vault:Pictures/old/graph.png",
			"local.png",
			"vault:Other/x.png",
		]);
		expect(renameVaultReferences(references, "Imag", "Nope")).toBeNull();
	});

	it("keeps vault references when questions and exams are saved and reopened", () => {
		const question = parseQuestionFile(serializeQuestion(basicAddition({ images: ["vault:Images/circuit.png", "local.png"] })));
		expect(question.ok && question.definition.images).toEqual(["vault:Images/circuit.png", "local.png"]);
		const exam = parseExamFile(
			serializeExam({ id: "e", title: "E", tags: [], timeLimitMinutes: null, passingPercent: 40, questions: [], attachments: ["vault:Sheets/formulae.pdf"] }),
		);
		expect(exam.ok && exam.definition.attachments).toEqual(["vault:Sheets/formulae.pdf"]);
	});
});

describe("finding identical files", () => {
	it("compares contents, not names", async () => {
		const vault = new FakeVault();
		vault.files.set("Images/circuit.png", encode("different picture"));
		vault.files.set("Elsewhere/renamed.png", encode("same picture!!"));
		expect(await findIdenticalFile(encode("same picture!!"), "circuit.png", vault.candidates(), (path) => vault.read(path))).toBe("Elsewhere/renamed.png");
	});

	it("only reads files of the same type and size", async () => {
		const vault = new FakeVault();
		vault.files.set("big.png", encode("a much longer file than the upload"));
		vault.files.set("same-size.jpg", encode("12345"));
		vault.files.set("match.png", encode("12345"));
		expect(await findIdenticalFile(encode("12345"), "upload.png", vault.candidates(), (path) => vault.read(path))).toBe("match.png");
		expect(vault.reads).toEqual(["match.png"]);
	});

	it("returns nothing when no file matches and survives unreadable files", async () => {
		const candidates = [{ path: "gone.png", size: 5 }];
		expect(await findIdenticalFile(encode("12345"), "a.png", candidates, () => Promise.reject(new Error("gone")))).toBeNull();
		expect(sameBytes(encode("abc"), encode("abd"))).toBe(false);
	});
});

describe("storing copies in the plugin folder", () => {
	it("reuses an identical file with the same name instead of writing another copy", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, "plugin/question-images");
		const first = await store.add("q-1", "circuit.png", encode("picture"), []);
		const second = await store.add("q-1", "circuit.png", encode("picture"), []);
		expect(second).toBe(first);
		expect(files.files.size).toBe(1);
	});

	it("keeps the existing file and picks a new name when the contents differ", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, "plugin/question-images");
		await store.add("q-1", "circuit.png", encode("first"), []);
		const second = await store.add("q-1", "circuit.png", encode("second"), []);
		expect(second).toBe("circuit (2).png");
		expect(new TextDecoder().decode(files.files.get("plugin/question-images/q-1/circuit.png"))).toBe("first");
	});

	it("never removes vault files when tidying up", async () => {
		const files = new FakeBinaryFiles();
		const store = new AttachmentStore(files, "plugin/question-images");
		const local = await store.add("q-1", "local.png", encode("local"), []);
		await store.prune("q-1", [local, vaultReference("Images/circuit.png")]);
		expect([...files.files.keys()]).toEqual(["plugin/question-images/q-1/local.png"]);
	});
});

describe("attaching files", () => {
	let files: FakeBinaryFiles;
	let vault: FakeVault;
	let access: AttachmentAccess;

	beforeEach(() => {
		files = new FakeBinaryFiles();
		vault = new FakeVault();
		access = { store: new AttachmentStore(files, "plugin/question-images"), vault: vault as unknown as VaultFiles, adapter: {} as AttachmentAccess["adapter"] };
		notices.length = 0;
	});

	const upload = (name: string, text: string) => new File([text], name);

	it("references an identical vault file instead of copying it", async () => {
		vault.files.set("Images/circuit.png", encode("the picture"));
		const added = await addAttachments(access, "q-1", [upload("my-upload.png", "the picture")], [], ["image"]);
		expect(added).toEqual(["vault:Images/circuit.png"]);
		expect(files.files.size).toBe(0);
	});

	it("copies the file when the vault only has a different file with the same name", async () => {
		vault.files.set("circuit.png", encode("something else"));
		const added = await addAttachments(access, "q-1", [upload("circuit.png", "the picture")], [], ["image"]);
		expect(added).toEqual(["circuit.png"]);
		expect(files.files.size).toBe(1);
		expect(vault.files.get("circuit.png")).toEqual(encode("something else"));
	});

	it("does not attach the same file twice, whether it lives in the vault or the plugin folder", async () => {
		vault.files.set("Images/circuit.png", encode("vault picture"));
		const first = await addAttachments(access, "q-1", [upload("a.png", "vault picture"), upload("b.png", "local picture")], [], ["image"]);
		const again = await addAttachments(access, "q-1", [upload("c.png", "vault picture"), upload("d.png", "local picture")], first, ["image"]);
		expect(first).toEqual(["vault:Images/circuit.png", "b.png"]);
		expect(again).toEqual([]);
		expect(files.files.size).toBe(1);
		expect(notices.filter((message) => message.includes("already attached"))).toHaveLength(2);
	});

	it("refuses files of the wrong type and empty files", async () => {
		const added = await addAttachments(access, "q-1", [upload("sheet.pdf", "pdf"), upload("blank.png", "")], [], ["image"]);
		expect(added).toEqual([]);
		expect(notices).toEqual(["sheet.pdf is not an image, so it was not attached.", "blank.png is empty."]);
	});
});
