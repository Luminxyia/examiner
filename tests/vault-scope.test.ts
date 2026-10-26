import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { initialSettings } from "../src/settings";
import { AttachmentStore, findIdenticalFile, withRenamedReferences } from "../src/storage/attachments";
import { filesInFolder, VaultFiles } from "../src/storage/vault-files";
import { addAttachments } from "../src/ui/attachment-picker";
import { FakeBinaryFiles } from "./fake-files";
import { TFile, TFolder } from "./obsidian-stub";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

function file(path: string, contents: string): TFile & { contents: ArrayBuffer } {
	return Object.assign(new TFile(), { path, stat: { size: encode(contents).byteLength }, contents: encode(contents) });
}

function folder(path: string, children: (TFile | TFolder)[]): TFolder {
	return Object.assign(new TFolder(), { path, children });
}

function fakeApp(root: TFolder) {
	const folders = new Map<string, TFolder>();
	const files = new Map<string, TFile & { contents: ArrayBuffer }>();
	const index = (entry: TFolder) => {
		folders.set(entry.path, entry);
		for (const child of entry.children) {
			if (child instanceof TFolder) index(child);
			else files.set(child.path, child as TFile & { contents: ArrayBuffer });
		}
	};
	index(root);
	const calls = { getFiles: 0, getMarkdownFiles: 0, folderLookups: [] as string[] };
	const vault = {
		getFiles: () => {
			calls.getFiles++;
			return [...files.values()];
		},
		getMarkdownFiles: () => {
			calls.getMarkdownFiles++;
			return [];
		},
		getFolderByPath: (path: string) => {
			calls.folderLookups.push(path);
			return folders.get(path) ?? null;
		},
		getFileByPath: (path: string) => files.get(path) ?? null,
		readBinary: (entry: TFile & { contents: ArrayBuffer }) => Promise.resolve(entry.contents),
		getResourcePath: (entry: TFile) => `app://vault/${entry.path}`,
	};
	return { app: { vault } as unknown as App, calls };
}

const tree = folder("", [
	file("note.md", "private note"),
	folder("Private", [file("Private/diary.png", "same picture")]),
	folder("Attachments", [
		file("Attachments/circuit.png", "circuit picture"),
		folder("Attachments/Physics", [file("Attachments/Physics/circuit.png", "same picture"), folder("Attachments/Physics/Deeper", [file("Attachments/Physics/Deeper/graph.png", "graph")])]),
	]),
]);

describe("files in a chosen folder", () => {
	it("walks the folder and its subfolders only", () => {
		const attachments = tree.children.find((child): child is TFolder => child instanceof TFolder && child.path === "Attachments");
		expect(attachments && filesInFolder(attachments as never).map((entry) => entry.path).sort()).toEqual([
			"Attachments/Physics/Deeper/graph.png",
			"Attachments/Physics/circuit.png",
			"Attachments/circuit.png",
		]);
	});
});

describe("VaultFiles", () => {
	it("looks at nothing when no folder is chosen", () => {
		const { app, calls } = fakeApp(tree);
		expect(new VaultFiles(app, () => "").candidates()).toEqual([]);
		expect(new VaultFiles(app, () => "   ").candidates()).toEqual([]);
		expect(calls).toEqual({ getFiles: 0, getMarkdownFiles: 0, folderLookups: [] });
	});

	it("only lists the chosen folder, never the whole vault", () => {
		const { app, calls } = fakeApp(tree);
		const paths = new VaultFiles(app, () => "Attachments/").candidates().map((entry) => entry.path);
		expect(paths).not.toContain("note.md");
		expect(paths).not.toContain("Private/diary.png");
		expect(paths).toHaveLength(3);
		expect(calls.getFiles).toBe(0);
		expect(calls.folderLookups).toEqual(["Attachments"]);
	});

	it("copes with a chosen folder that no longer exists", () => {
		const { app } = fakeApp(tree);
		expect(new VaultFiles(app, () => "Deleted folder").candidates()).toEqual([]);
	});

	it("reads attached files by path and reports missing ones", async () => {
		const { app } = fakeApp(tree);
		const vault = new VaultFiles(app, () => "");
		expect(new TextDecoder().decode(await vault.read("Private/diary.png"))).toBe("same picture");
		expect(vault.resourcePath("Attachments/circuit.png")).toBe("app://vault/Attachments/circuit.png");
		expect(vault.resourcePath("gone.png")).toBeNull();
		await expect(vault.read("gone.png")).rejects.toThrow("no longer in the vault");
	});

	it("tells same-named files in different folders apart by content", async () => {
		const { app } = fakeApp(tree);
		const vault = new VaultFiles(app, () => "Attachments");
		const match = await findIdenticalFile(encode("same picture"), "circuit.png", vault.candidates(), (path) => vault.read(path));
		expect(match).toBe("Attachments/Physics/circuit.png");
	});

	it("does not reuse a matching file outside the chosen folder", async () => {
		const { app } = fakeApp(tree);
		const files = new FakeBinaryFiles();
		const access = { store: new AttachmentStore(files, "plugin/question-images"), vault: new VaultFiles(app, () => "Attachments/Physics/Deeper"), adapter: {} as never };
		const added = await addAttachments(access, "q-1", [new File(["same picture"], "upload.png")], [], ["image"]);
		expect(added).toEqual(["upload.png"]);
		expect(files.files.size).toBe(1);
	});

	it("copies attachments without looking at the vault when the setting is empty", async () => {
		const { app, calls } = fakeApp(tree);
		const files = new FakeBinaryFiles();
		const access = { store: new AttachmentStore(files, "plugin/question-images"), vault: new VaultFiles(app, () => ""), adapter: {} as never };
		const added = await addAttachments(access, "q-1", [new File(["circuit picture"], "circuit.png")], [], ["image"]);
		expect(added).toEqual(["circuit.png"]);
		expect(calls).toEqual({ getFiles: 0, getMarkdownFiles: 0, folderLookups: [] });
	});
});

describe("settings on a fresh install", () => {
	it("skips the old-notes import when there is no saved data", () => {
		expect(initialSettings(null)).toEqual({ exampleCreated: false, vaultFilesImported: true, reuseFolder: "" });
	});

	it("still runs the one-time import when upgrading from saved data", () => {
		expect(initialSettings({ exampleCreated: true })).toMatchObject({ vaultFilesImported: false, reuseFolder: "" });
		expect(initialSettings({ exampleCreated: true, vaultFilesImported: true, reuseFolder: "Attachments" })).toMatchObject({
			vaultFilesImported: true,
			reuseFolder: "Attachments",
		});
	});
});

describe("following renames", () => {
	const questions = [
		{ id: "q-1", images: ["vault:Attachments/circuit.png", "local.png"] },
		{ id: "q-2", images: ["local.png"] },
		{ id: "q-3" },
	];

	it("does nothing for renames that Examiner does not refer to", () => {
		expect(withRenamedReferences(questions, "images", "Private/diary.png", "Private/old-diary.png")).toEqual([]);
	});

	it("returns only the items that need saving", () => {
		expect(withRenamedReferences(questions, "images", "Attachments", "Resources")).toEqual([
			{ id: "q-1", images: ["vault:Resources/circuit.png", "local.png"] },
		]);
	});
});
