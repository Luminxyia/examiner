import { normalizePath, TFile, TFolder, type App } from "obsidian";
import type { VaultCandidate } from "./attachments";

export function filesInFolder(folder: TFolder): VaultCandidate[] {
	const found: VaultCandidate[] = [];
	const pending: TFolder[] = [folder];
	for (let current = pending.pop(); current; current = pending.pop()) {
		for (const child of current.children) {
			if (child instanceof TFile) found.push({ path: child.path, size: child.stat.size });
			else if (child instanceof TFolder) pending.push(child);
		}
	}
	return found;
}

export class VaultFiles {
	constructor(
		private readonly app: App,
		private readonly reuseFolder: () => string,
	) {}

	candidates(): VaultCandidate[] {
		const setting = this.reuseFolder().trim();
		if (setting === "") return [];
		const folder = this.app.vault.getFolderByPath(normalizePath(setting));
		return folder ? filesInFolder(folder) : [];
	}

	read(path: string): Promise<ArrayBuffer> {
		const file = this.file(path);
		return file ? this.app.vault.readBinary(file) : Promise.reject(new Error("The file is no longer in the vault."));
	}

	resourcePath(path: string): string | null {
		const file = this.file(path);
		return file ? this.app.vault.getResourcePath(file) : null;
	}

	private file(path: string): TFile | null {
		return this.app.vault.getFileByPath(path);
	}
}
