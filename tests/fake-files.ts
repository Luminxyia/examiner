import type { FolderFiles } from "../src/storage/library";
import type { BinaryFiles } from "../src/storage/attachments";
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

export class FakeBinaryFiles implements BinaryFiles {
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
