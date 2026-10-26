import { VARIABLE_NAME_PATTERN } from "./expression";

export interface TemplateReference {
	name: string;
	start: number;
	end: number;
	inMath: boolean;
}

export interface MathRange {
	from: number;
	to: number;
	source: string;
	display: boolean;
}

export function findMathRanges(text: string): MathRange[] {
	const ranges: MathRange[] = [];
	let i = 0;
	while (i < text.length) {
		const char = text.charAt(i);
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char !== "$") {
			i++;
			continue;
		}
		if (text.charAt(i + 1) === "$") {
			const close = findUnescaped(text, "$$", i + 2);
			if (close === -1) break;
			ranges.push({ from: i, to: close + 2, source: text.slice(i + 2, close), display: true });
			i = close + 2;
			continue;
		}
		const close = findUnescaped(text, "$", i + 1);
		const source = close === -1 ? "" : text.slice(i + 1, close);
		if (close !== -1 && source !== "" && !source.includes("\n") && !/^\s|\s$/.test(source)) {
			ranges.push({ from: i, to: close + 1, source, display: false });
			i = close + 1;
		} else {
			i++;
		}
	}
	return ranges;
}

function findUnescaped(text: string, token: string, from: number): number {
	for (let i = from; i <= text.length - token.length; i++) {
		if (text.charAt(i) === "\\") {
			i++;
			continue;
		}
		if (text.startsWith(token, i)) return i;
	}
	return -1;
}

export function findTemplateReferences(template: string): TemplateReference[] {
	const references: TemplateReference[] = [];
	const math = findMathRanges(template);
	for (let i = 0; i < template.length; i++) {
		const char = template.charAt(i);
		if (char === "\\") {
			i++;
			continue;
		}
		if (char !== "{") continue;
		const close = template.indexOf("}", i + 1);
		if (close === -1) break;
		const name = template.slice(i + 1, close).trim();
		if (VARIABLE_NAME_PATTERN.test(name)) {
			const inMath = math.some((range) => i > range.from && i < range.to);
			references.push({ name, start: i, end: close + 1, inMath });
		}
	}
	return references;
}

export function renderTemplate(template: string, values: ReadonlyMap<string, string>): string {
	let output = "";
	let cursor = 0;
	for (const reference of findTemplateReferences(template)) {
		const value = values.get(reference.name);
		if (value === undefined) continue;
		output += template.slice(cursor, reference.start) + (reference.inMath ? `{${value}}` : value);
		cursor = reference.end;
	}
	return output + template.slice(cursor);
}
