import { parseYaml, stringifyYaml } from "obsidian";

export type Frontmatter = Record<string, unknown>;

export interface SplitFile {
	frontmatter: string | null;
	body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(content: string): SplitFile {
	const match = FRONTMATTER_PATTERN.exec(content);
	if (!match) return { frontmatter: null, body: content };
	return { frontmatter: match[1] ?? "", body: content.slice(match[0].length) };
}

export type FrontmatterRead = { ok: true; data: Frontmatter; body: string } | { ok: false; error: string };

export function readFrontmatter(content: string): FrontmatterRead {
	const { frontmatter, body } = splitFrontmatter(content);
	if (frontmatter === null) return { ok: true, data: {}, body };
	let data: unknown;
	try {
		data = parseYaml(frontmatter);
	} catch (error) {
		return { ok: false, error: `The frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (data === null || data === undefined) return { ok: true, data: {}, body };
	if (typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "The frontmatter must be a set of properties." };
	return { ok: true, data: data as Frontmatter, body };
}

export function composeFile(managed: Frontmatter, body: string, previous: Frontmatter = {}): string {
	const merged: Frontmatter = {};
	for (const [key, value] of Object.entries(previous)) {
		merged[key] = key in managed ? managed[key] : value;
	}
	for (const [key, value] of Object.entries(managed)) {
		if (!(key in merged)) merged[key] = value;
	}
	for (const [key, value] of Object.entries(merged)) {
		if (value === undefined) delete merged[key];
	}
	const yaml = stringifyYaml(merged).trimEnd();
	return `---\n${yaml}\n---\n${body}`;
}
