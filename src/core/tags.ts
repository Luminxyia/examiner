export function normaliseTag(raw: string): string | null {
	const segments = raw
		.trim()
		.replace(/^#+/, "")
		.replace(/\\/g, "/")
		.split("/")
		.map((segment) => segment.trim().replace(/\s+/g, "-"))
		.filter((segment) => segment !== "");
	return segments.length > 0 ? segments.join("/") : null;
}

export function normaliseTags(raw: readonly string[]): string[] {
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const value of raw) {
		const tag = normaliseTag(value);
		if (!tag || seen.has(tag.toLowerCase())) continue;
		seen.add(tag.toLowerCase());
		tags.push(tag);
	}
	return tags;
}

export function tagMatches(tag: string, filter: string): boolean {
	const t = tag.toLowerCase();
	const f = filter.toLowerCase();
	return t === f || t.startsWith(`${f}/`);
}

export function hasAnyTag(tags: readonly string[], filters: readonly string[]): boolean {
	return filters.some((filter) => tags.some((tag) => tagMatches(tag, filter)));
}
