import { Notice, setIcon, type DataAdapter } from "obsidian";
import {
	AttachmentError,
	attachmentKind,
	attachmentLabel,
	findIdenticalFile,
	isVaultReference,
	MAX_ATTACHMENT_BYTES,
	sameBytes,
	vaultPathOf,
	vaultReference,
	type AttachmentKind,
	type AttachmentStore,
} from "../storage/attachments";
import type { VaultFiles } from "../storage/vault-files";
import { textButton } from "./shared";

export interface AttachmentAccess {
	store: AttachmentStore;
	vault: VaultFiles;
	adapter: DataAdapter;
}

export interface AttachmentPickerOptions {
	names: readonly string[];
	hint: string;
	accept: string;
	onFiles(files: File[]): void;
	onRemove(name: string): void;
}

export function renderAttachmentPicker(el: HTMLElement, options: AttachmentPickerOptions): void {
	el.empty();
	if (options.names.length > 0) {
		const list = el.createDiv({ cls: "examiner-attachment-list" });
		for (const name of options.names) {
			const label = attachmentLabel(name);
			const row = list.createDiv({ cls: "examiner-attachment-row" });
			setIcon(row.createSpan({ cls: "examiner-attachment-icon" }), attachmentKind(name) === "pdf" ? "file-text" : "image");
			row.createSpan({ cls: "examiner-attachment-name", text: label, attr: { title: isVaultReference(name) ? `${label} (in your vault)` : label } });
			const remove = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Remove ${label}` } });
			setIcon(remove, "x");
			remove.addEventListener("click", () => options.onRemove(name));
		}
	}

	const zone = el.createDiv({ cls: "examiner-dropzone" });
	zone.createSpan({ cls: "examiner-muted examiner-small", text: options.hint });
	const input = zone.createEl("input", { type: "file", cls: "examiner-file-input", attr: { accept: options.accept, multiple: "" } });
	textButton(zone, "Browse").addEventListener("click", () => input.click());
	input.addEventListener("change", () => {
		const files = Array.from(input.files ?? []);
		input.value = "";
		options.onFiles(files);
	});
	zone.addEventListener("dragover", (event) => {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		zone.addClass("is-dragging");
	});
	zone.addEventListener("dragleave", (event) => {
		if (!zone.contains(event.relatedTarget as Node | null)) zone.removeClass("is-dragging");
	});
	zone.addEventListener("drop", (event) => {
		event.preventDefault();
		zone.removeClass("is-dragging");
		options.onFiles(Array.from(event.dataTransfer?.files ?? []));
	});
}

export function readAttachment(access: AttachmentAccess, ownerId: string, reference: string): Promise<ArrayBuffer> {
	return isVaultReference(reference) ? access.vault.read(vaultPathOf(reference)) : access.store.read(ownerId, reference);
}

export function attachmentResourcePath(access: AttachmentAccess, ownerId: string, reference: string): string | null {
	if (isVaultReference(reference)) return access.vault.resourcePath(vaultPathOf(reference));
	try {
		return access.adapter.getResourcePath(access.store.path(ownerId, reference));
	} catch {
		return null;
	}
}

async function isAlreadyAttached(access: AttachmentAccess, ownerId: string, data: ArrayBuffer, attached: readonly string[]): Promise<boolean> {
	for (const reference of attached) {
		try {
			if (sameBytes(await readAttachment(access, ownerId, reference), data)) return true;
		} catch {
			continue;
		}
	}
	return false;
}

export async function addAttachments(
	access: AttachmentAccess,
	ownerId: string,
	files: readonly File[],
	taken: readonly string[],
	allowed: readonly AttachmentKind[],
): Promise<string[]> {
	const added: string[] = [];
	for (const file of files) {
		const kind = attachmentKind(file.name);
		if (kind === null || !allowed.includes(kind)) {
			new Notice(`${file.name} is not ${allowed.includes("pdf") ? "a PDF or an image" : "an image"}, so it was not attached.`);
			continue;
		}
		try {
			const data = await file.arrayBuffer();
			if (data.byteLength === 0) throw new AttachmentError(`${file.name} is empty.`);
			if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${file.name} is larger than 25 MB.`);
			const attached = [...taken, ...added];
			if (await isAlreadyAttached(access, ownerId, data, attached)) {
				new Notice(`${file.name} is already attached.`);
				continue;
			}
			const match = await findIdenticalFile(data, file.name, access.vault.candidates(), (path) => access.vault.read(path));
			const reference = match ? vaultReference(match) : await access.store.add(ownerId, file.name, data, attached);
			if (match) new Notice(`Using ${match} from your vault instead of making a copy.`);
			added.push(reference);
		} catch (error) {
			console.error("Examiner: could not attach a file", error);
			new Notice(error instanceof AttachmentError ? error.message : `Could not attach ${file.name}.`);
		}
	}
	return added;
}

export function renderQuestionImages(parent: HTMLElement, access: AttachmentAccess, questionId: string, names: readonly string[] | undefined): void {
	if (!names || names.length === 0) return;
	const gallery = parent.createDiv({ cls: "examiner-question-images" });
	for (const name of names) {
		const label = attachmentLabel(name);
		const missing = () => createDiv({ cls: "examiner-muted examiner-small", text: `Image not found: ${label}` });
		const src = attachmentResourcePath(access, questionId, name);
		if (src === null) {
			gallery.append(missing());
			continue;
		}
		const image = gallery.createEl("img", { cls: "examiner-question-image", attr: { src, alt: label } });
		image.addEventListener("error", () => image.replaceWith(missing()));
	}
}
