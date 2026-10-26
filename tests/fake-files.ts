import type { FolderFiles } from "../src/storage/library";
import type { DataFiles } from "../src/storage/results";

export class FakeFolderFiles implements FolderFiles {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readonly trashed: string[] = [];

	content(path: string): string {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`No file at ${path}`);
		return content;
	}

	list(folder: string): Promise<string[]> {
		const prefix = `${folder}/`;
		const paths = [...this.files.keys()].filter(
			(path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && path.endsWith(".md"),
		);
		return Promise.resolve(paths.sort());
	}

	read(path: string): Promise<string> {
		return Promise.resolve(this.content(path));
	}

	write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
		return Promise.resolve();
	}

	trash(path: string): Promise<void> {
		this.files.delete(path);
		this.trashed.push(path);
		return Promise.resolve();
	}

	ensureFolder(folder: string): Promise<void> {
		this.folders.add(folder);
		return Promise.resolve();
	}
}

export class FakeDataFiles implements DataFiles {
	readonly files = new Map<string, string>();

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path));
	}

	read(path: string): Promise<string> {
		const content = this.files.get(path);
		return content === undefined ? Promise.reject(new Error(`No file at ${path}`)) : Promise.resolve(content);
	}

	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}

	append(path: string, data: string): Promise<void> {
		this.files.set(path, (this.files.get(path) ?? "") + data);
		return Promise.resolve();
	}

	remove(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}
}
