import { readFrontmatter } from "./frontmatter";
import { fileKindOf, type FileKind, type ParseResult } from "./format-shared";

export interface FolderFiles {
	list(folder: string): Promise<string[]>;
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	trash(path: string): Promise<void>;
	ensureFolder(folder: string): Promise<void>;
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
		const path = this.pathFor(definition.id);
		if (this.entries.has(path)) throw new Error(`A file named ${path} already exists.`);
		await this.files.ensureFolder(this.folder);
		await this.write(path, this.format.serialize(definition));
		return path;
	}

	async save(definition: T): Promise<string> {
		const path = this.pathById.get(definition.id);
		if (path === undefined) throw new Error(`No file has the ID ${definition.id}.`);
		const current = await this.files.read(path);
		await this.write(path, this.format.serialize(definition, current));
		return path;
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
		await this.write(this.pathFor(newId), this.format.serialize({ ...result.definition, id: newId }, current));
		await this.files.trash(path);
		this.entries.delete(path);
		this.refresh();
	}

	async import(content: string): Promise<boolean> {
		const read = readFrontmatter(content);
		if (!read.ok || fileKindOf(read.data) !== this.format.kind) return false;
		const result = this.format.parse(content);
		if (!result.ok || this.pathById.has(result.definition.id)) return false;
		await this.files.ensureFolder(this.folder);
		await this.write(this.pathFor(result.definition.id), content);
		return true;
	}

	private pathFor(id: string): string {
		return `${this.folder}/${id}.md`;
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
		const ownsName = (path: string, id: string) => path === this.pathFor(id);
		const ordered = [...this.entries].sort(([a], [b]) => a.localeCompare(b));
		this.pathById = new Map();
		this.duplicates = new Map();
		for (const [path, result] of ordered) {
			if (!result.ok) continue;
			const id = result.definition.id;
			const winner = this.pathById.get(id);
			if (winner === undefined) {
				this.pathById.set(id, path);
			} else if (ownsName(path, id)) {
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
