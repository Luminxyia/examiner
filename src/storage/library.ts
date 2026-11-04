import { readFrontmatter } from "./frontmatter";
import { fileKindOf, type FileKind, type ParseResult } from "./format-shared";

export interface FolderFiles {
	list(folder: string): Promise<string[]>;
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	rename(from: string, to: string): Promise<void>;
	trash(path: string): Promise<void>;
	ensureFolder(folder: string): Promise<void>;
}

export type FileNameChange = (previousName: string, newName: string) => Promise<void>;

const MAX_FILE_NAME_LENGTH = 100;

export function fileNameFor(title: string, fallback: string): string {
	let name = Array.from(title, (char) => (char.charCodeAt(0) < 32 ? "-" : char)).join("");
	name = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
	name = name.replace(/\s+/g, " ").trim();
	name = name.replace(/^\.+/, "");
	if (name.length > MAX_FILE_NAME_LENGTH) {
		name = name.slice(0, MAX_FILE_NAME_LENGTH);
	}
	name = name.replace(/[. ]+$/, "");
	if (name === "") {
		return fallback;
	}
	return name;
}

function nameOfPath(path: string): string {
	const file = path.split("/").pop() ?? path;
	return file.replace(/\.md$/, "");
}

export interface DefinitionFormat<T> {
	kind: FileKind;
	parse(content: string): ParseResult<T>;
	serialize(definition: T, previousContent?: string): string;
}

export interface FileProblem {
	path: string;
	errors: string[];
	duplicateOf?: string;
}

export class DefinitionLibrary<T extends { id: string; title: string }> {
	private readonly entries = new Map<string, ParseResult<T>>();
	private pathById = new Map<string, string>();
	private duplicates = new Map<string, string>();
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly files: FolderFiles,
		private readonly format: DefinitionFormat<T>,
		readonly folder: string,
		private readonly onFileNameChange?: FileNameChange,
	) {}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async load(): Promise<void> {
		this.entries.clear();
		for (const path of await this.files.list(this.folder)) {
			try {
				this.entries.set(path, this.parse(await this.files.read(path)));
			} catch (error) {
				this.entries.set(path, { ok: false, errors: [`The file could not be read: ${describe(error)}`] });
			}
		}
		this.refresh();
	}

	definitions(): T[] {
		const definitions: T[] = [];
		for (const path of this.pathById.values()) {
			const result = this.entries.get(path);
			if (result?.ok) definitions.push(result.definition);
		}
		return definitions.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
	}

	get(id: string): T | undefined {
		const path = this.pathById.get(id);
		const result = path === undefined ? undefined : this.entries.get(path);
		return result?.ok ? result.definition : undefined;
	}

	pathOf(id: string): string | undefined {
		return this.pathById.get(id);
	}

	fileNameOf(id: string): string | undefined {
		const path = this.pathById.get(id);
		if (path === undefined) {
			return undefined;
		}
		return nameOfPath(path);
	}

	problems(): FileProblem[] {
		const problems: FileProblem[] = [];
		for (const [path, result] of this.entries) {
			if (!result.ok) {
				problems.push({ path, errors: result.errors });
				continue;
			}
			const winner = this.duplicates.get(path);
			if (winner !== undefined) {
				problems.push({ path, errors: [`It has the same ID as ${winner}, so it is ignored.`], duplicateOf: winner });
			}
		}
		return problems.sort((a, b) => a.path.localeCompare(b.path));
	}

	async create(definition: T): Promise<string> {
		if (this.pathById.has(definition.id)) throw new Error(`A file with the ID ${definition.id} already exists.`);
		await this.files.ensureFolder(this.folder);
		const path = await this.freePath(definition.title, definition.id, null);
		await this.write(path, this.format.serialize(definition));
		await this.fileNameChanged(definition.id, nameOfPath(path));
		return path;
	}

	async save(definition: T): Promise<string> {
		const path = this.pathById.get(definition.id);
		if (path === undefined) throw new Error(`No file has the ID ${definition.id}.`);
		const current = await this.files.read(path);
		let target = path;
		const previous = this.entries.get(path);
		if (previous?.ok && previous.definition.title.trim() !== definition.title.trim()) {
			target = await this.freePath(definition.title, definition.id, path);
		}
		if (target !== path) {
			await this.files.rename(path, target);
			this.entries.delete(path);
		}
		await this.write(target, this.format.serialize(definition, current));
		if (target !== path) {
			await this.fileNameChanged(nameOfPath(path), nameOfPath(target));
		}
		return target;
	}

	async delete(id: string): Promise<void> {
		const path = this.pathById.get(id);
		if (path === undefined) return;
		await this.files.trash(path);
		this.entries.delete(path);
		this.refresh();
	}

	async clear(): Promise<void> {
		try {
			for (const path of [...this.entries.keys()]) {
				await this.files.trash(path);
				this.entries.delete(path);
			}
		} finally {
			this.refresh();
		}
	}

	async assignNewId(path: string, newId: string): Promise<void> {
		const result = this.entries.get(path);
		if (!result?.ok) return;
		const current = await this.files.read(path);
		await this.write(path, this.format.serialize({ ...result.definition, id: newId }, current));
	}

	async import(content: string): Promise<boolean> {
		const read = readFrontmatter(content);
		if (!read.ok || fileKindOf(read.data) !== this.format.kind) return false;
		const result = this.format.parse(content);
		if (!result.ok || this.pathById.has(result.definition.id)) return false;
		await this.files.ensureFolder(this.folder);
		const path = await this.freePath(result.definition.title, result.definition.id, null);
		await this.write(path, content);
		return true;
	}

	private preferredPath(definition: T): string {
		return `${this.folder}/${fileNameFor(definition.title, definition.id)}.md`;
	}

	private async freePath(title: string, id: string, currentPath: string | null): Promise<string> {
		const base = fileNameFor(title, id);
		for (let index = 1; ; index++) {
			let name = base;
			if (index > 1) {
				name = `${base} (${index})`;
			}
			const path = `${this.folder}/${name}.md`;
			if (currentPath !== null && path.toLowerCase() === currentPath.toLowerCase()) {
				return currentPath;
			}
			if (await this.isTaken(path)) {
				continue;
			}
			return path;
		}
	}

	private async isTaken(path: string): Promise<boolean> {
		const lower = path.toLowerCase();
		for (const existing of this.entries.keys()) {
			if (existing.toLowerCase() === lower) {
				return true;
			}
		}
		return this.files.exists(path);
	}

	private async fileNameChanged(previousName: string, newName: string): Promise<void> {
		if (this.onFileNameChange === undefined) {
			return;
		}
		await this.onFileNameChange(previousName, newName);
	}

	private async write(path: string, content: string): Promise<void> {
		await this.files.write(path, content);
		this.entries.set(path, this.parse(content));
		this.refresh();
	}

	private parse(content: string): ParseResult<T> {
		const read = readFrontmatter(content);
		if (read.ok && fileKindOf(read.data) !== this.format.kind) {
			return { ok: false, errors: [`This is not an Examiner ${this.format.kind} file. It needs "examiner: ${this.format.kind}".`] };
		}
		return this.format.parse(content);
	}

	private refresh(): void {
		const ownsName = (path: string, definition: T) => path === this.preferredPath(definition);
		const ordered = [...this.entries].sort(([a], [b]) => a.localeCompare(b));
		this.pathById = new Map();
		this.duplicates = new Map();
		for (const [path, result] of ordered) {
			if (!result.ok) continue;
			const id = result.definition.id;
			const winner = this.pathById.get(id);
			if (winner === undefined) {
				this.pathById.set(id, path);
			} else if (ownsName(path, result.definition)) {
				this.duplicates.set(winner, path);
				this.pathById.set(id, path);
			} else {
				this.duplicates.set(path, winner);
			}
		}
		for (const listener of this.listeners) listener();
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
