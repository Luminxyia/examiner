import { normalizePath, type DataAdapter } from "obsidian";
import type { FolderFiles } from "./library";

export class AdapterFolderFiles implements FolderFiles {
	constructor(private readonly adapter: DataAdapter) {}

	async list(folder: string): Promise<string[]> {
		const path = normalizePath(folder);
		if (!(await this.adapter.exists(path))) return [];
		const listed = await this.adapter.list(path);
		return listed.files.filter((file) => file.endsWith(".md")).sort();
	}

	read(path: string): Promise<string> {
		return this.adapter.read(normalizePath(path));
	}

	write(path: string, content: string): Promise<void> {
		return this.adapter.write(normalizePath(path), content);
	}

	async trash(path: string): Promise<void> {
		const normalised = normalizePath(path);
		if (!(await this.adapter.trashSystem(normalised))) await this.adapter.trashLocal(normalised);
	}

	async ensureFolder(folder: string): Promise<void> {
		const path = normalizePath(folder);
		if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
	}
}
