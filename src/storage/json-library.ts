import { asRecord, type ParseResult } from "./format-shared";

export const JSON_LIBRARY_VERSION = 1;

export interface JsonLibraryFiles {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface JsonRecordFormat<T> {
	collection: string;
	parse(id: string, record: unknown): ParseResult<T>;
	toRecord(definition: T): Record<string, unknown>;
}

export interface RecordProblem {
	id: string;
	errors: string[];
}

type Records = Record<string, unknown>;

export class JsonLibrary<T extends { id: string; title: string }> {
	private entries = new Map<string, ParseResult<T>>();
	private writes: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly files: JsonLibraryFiles,
		private readonly format: JsonRecordFormat<T>,
		readonly path: string,
	) {}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	load(): Promise<void> {
		return this.serially(async () => {
			const records = await this.readRecords();
			this.showRecords(records);
		});
	}

	definitions(): T[] {
		const definitions: T[] = [];
		for (const result of this.entries.values()) {
			if (result.ok) {
				definitions.push(result.definition);
			}
		}
		return definitions.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
	}

	get(id: string): T | undefined {
		const result = this.entries.get(id);
		if (result === undefined || !result.ok) {
			return undefined;
		}
		return result.definition;
	}

	has(id: string): boolean {
		return this.get(id) !== undefined;
	}

	problems(): RecordProblem[] {
		const problems: RecordProblem[] = [];
		for (const [id, result] of this.entries) {
			if (!result.ok) {
				problems.push({ id, errors: result.errors });
			}
		}
		return problems.sort((a, b) => a.id.localeCompare(b.id));
	}

	create(definition: T): Promise<void> {
		return this.change((records) => {
			if (definition.id in records) {
				throw new Error(`An item with the ID ${definition.id} already exists.`);
			}
			records[definition.id] = this.format.toRecord(definition);
		});
	}

	save(definition: T): Promise<void> {
		return this.change((records) => {
			if (!(definition.id in records)) {
				throw new Error(`No item has the ID ${definition.id}.`);
			}
			records[definition.id] = this.format.toRecord(definition);
		});
	}

	delete(id: string): Promise<void> {
		return this.change((records) => {
			delete records[id];
		});
	}

	clear(): Promise<void> {
		return this.change((records) => {
			for (const id of Object.keys(records)) {
				delete records[id];
			}
		});
	}

	private change(apply: (records: Records) => void): Promise<void> {
		return this.serially(async () => {
			const records = await this.readRecords();
			apply(records);
			await this.writeRecords(records);
			this.showRecords(records);
		});
	}

	private serially<R>(task: () => Promise<R>): Promise<R> {
		const run = this.writes.then(task);
		this.writes = run.catch(() => undefined);
		return run;
	}

	private get temporaryPath(): string {
		return `${this.path}.tmp`;
	}

	private get backupPath(): string {
		return `${this.path}.bak`;
	}

	private async readRecords(): Promise<Records> {
		let path = this.path;
		if (!(await this.files.exists(path))) {
			if (!(await this.files.exists(this.backupPath))) {
				return {};
			}
			path = this.backupPath;
		}
		const content = await this.files.read(path);
		return this.parseDocument(path, content);
	}

	private parseDocument(path: string, content: string): Records {
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${path} is damaged and was left unchanged: ${reason}`);
		}
		const document = asRecord(parsed);
		if (document === null) {
			throw new Error(`${path} is damaged and was left unchanged.`);
		}
		const version = document.version;
		if (typeof version !== "number") {
			throw new Error(`${path} is damaged and was left unchanged: it has no version.`);
		}
		if (version > JSON_LIBRARY_VERSION) {
			throw new Error(`${path} uses format version ${version}, which needs a newer version of Examiner.`);
		}
		const records = asRecord(document[this.format.collection]);
		if (records === null) {
			throw new Error(`${path} is damaged and was left unchanged: it has no "${this.format.collection}" section.`);
		}
		return records;
	}

	private async writeRecords(records: Records): Promise<void> {
		const document = { version: JSON_LIBRARY_VERSION, [this.format.collection]: records };
		await this.files.write(this.temporaryPath, `${JSON.stringify(document, null, 2)}\n`);
		if (await this.files.exists(this.path)) {
			if (await this.files.exists(this.backupPath)) {
				await this.files.remove(this.backupPath);
			}
			await this.files.rename(this.path, this.backupPath);
		}
		await this.files.rename(this.temporaryPath, this.path);
	}

	private showRecords(records: Records): void {
		const entries = new Map<string, ParseResult<T>>();
		for (const [id, record] of Object.entries(records)) {
			entries.set(id, this.format.parse(id, record));
		}
		this.entries = entries;
		for (const listener of this.listeners) {
			listener();
		}
	}
}
