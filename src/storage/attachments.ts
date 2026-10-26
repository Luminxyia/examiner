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

const VAULT_PREFIX = "vault:";

export function isVaultReference(reference: string): boolean {
	return reference.startsWith(VAULT_PREFIX);
}

export function vaultPathOf(reference: string): string {
	return reference.slice(VAULT_PREFIX.length);
}

export function vaultReference(path: string): string {
	return `${VAULT_PREFIX}${path}`;
}

export function isSafeVaultPath(path: string): boolean {
	if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
	return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") && attachmentKind(path) !== null;
}

export function isValidAttachmentReference(reference: string): boolean {
	return isVaultReference(reference) ? isSafeVaultPath(vaultPathOf(reference)) : isSafeAttachmentName(reference);
}

export function attachmentLabel(reference: string): string {
	return isVaultReference(reference) ? vaultPathOf(reference) : reference;
}

export function renameVaultReferences(references: readonly string[], oldPath: string, newPath: string): string[] | null {
	let changed = false;
	const renamed = references.map((reference) => {
		if (!isVaultReference(reference)) return reference;
		const path = vaultPathOf(reference);
		if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return reference;
		changed = true;
		return vaultReference(`${newPath}${path.slice(oldPath.length)}`);
	});
	return changed ? renamed : null;
}

export function withRenamedReferences<K extends string, T extends Partial<Record<K, string[]>>>(
	items: readonly T[],
	key: K,
	oldPath: string,
	newPath: string,
): T[] {
	return items.flatMap((item) => {
		const renamed = renameVaultReferences(item[key] ?? [], oldPath, newPath);
		return renamed ? [{ ...item, [key]: renamed }] : [];
	});
}

export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

export interface VaultCandidate {
	path: string;
	size: number;
}

export async function findIdenticalFile(
	data: ArrayBuffer,
	fileName: string,
	candidates: readonly VaultCandidate[],
	read: (path: string) => Promise<ArrayBuffer>,
): Promise<string | null> {
	const extension = extensionOf(fileName);
	for (const candidate of candidates) {
		if (candidate.size !== data.byteLength || extensionOf(candidate.path) !== extension) continue;
		try {
			if (sameBytes(await read(candidate.path), data)) return candidate.path;
		} catch {
			continue;
		}
	}
	return null;
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

	private ownerFolder(ownerId: string): string {
		return `${this.folder}/${ownerId}`;
	}

	path(ownerId: string, name: string): string {
		if (!isSafeAttachmentName(name)) throw new AttachmentError(`"${name}" is not a valid attachment name.`);
		return `${this.ownerFolder(ownerId)}/${name}`;
	}

	async add(ownerId: string, fileName: string, data: ArrayBuffer, taken: readonly string[]): Promise<string> {
		const cleaned = sanitiseFileName(fileName);
		if (attachmentKind(cleaned) === null) throw new AttachmentError(`${cleaned} is not a PDF or an image.`);
		if (data.byteLength === 0) throw new AttachmentError(`${cleaned} is empty.`);
		if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${cleaned} is larger than 25 MB.`);
		const { name, exists } = await this.chooseName(ownerId, cleaned, data, taken);
		if (exists) return name;
		if (!(await this.files.exists(this.folder))) await this.files.mkdir(this.folder);
		if (!(await this.files.exists(this.ownerFolder(ownerId)))) await this.files.mkdir(this.ownerFolder(ownerId));
		await this.files.writeBinary(this.path(ownerId, name), data);
		return name;
	}

	async read(ownerId: string, name: string): Promise<ArrayBuffer> {
		return this.files.readBinary(this.path(ownerId, name));
	}

	async prune(ownerId: string, keep: readonly string[]): Promise<void> {
		const folder = this.ownerFolder(ownerId);
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

	async removeOwner(ownerId: string): Promise<void> {
		const folder = this.ownerFolder(ownerId);
		if (await this.files.exists(folder)) await this.files.rmdir(folder, true);
	}

	async clear(): Promise<void> {
		if (await this.files.exists(this.folder)) await this.files.rmdir(this.folder, true);
	}

	private async chooseName(
		ownerId: string,
		name: string,
		data: ArrayBuffer,
		taken: readonly string[],
	): Promise<{ name: string; exists: boolean }> {
		const dot = name.lastIndexOf(".");
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : "";
		const used = new Set(taken.map((entry) => entry.toLowerCase()));
		for (let index = 1; ; index++) {
			const candidate = index === 1 ? name : `${stem} (${index})${extension}`;
			const path = `${this.ownerFolder(ownerId)}/${candidate}`;
			if (await this.files.exists(path)) {
				if (sameBytes(await this.files.readBinary(path), data)) return { name: candidate, exists: true };
				continue;
			}
			if (used.has(candidate.toLowerCase())) continue;
			return { name: candidate, exists: false };
		}
	}
}
