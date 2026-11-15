import { tokenise, type Placement, type Token } from "./diagram";

const PLACEMENT_WORDS: readonly string[] = ["above", "below", "left", "right"];
const BLOCK_PATTERN = /^```examiner-diagram[^\n]*\n([\s\S]*?)^```/gm;

export interface DiagramBlock {
	start: number;
	end: number;
	source: string;
}

export function formatNumber(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	if (Object.is(rounded, -0)) return "0";
	return String(rounded);
}

export function joinTokens(tokens: readonly Token[]): string {
	let text = "";
	for (const token of tokens) {
		if (!token.quoted && token.text === ",") {
			text += ",";
			continue;
		}
		let piece = token.text;
		if (token.quoted) piece = `"${token.text}"`;
		if (text === "") text = piece;
		else text += ` ${piece}`;
	}
	return text;
}

function safeTokens(line: string): Token[] | null {
	try {
		return tokenise(line);
	} catch {
		return null;
	}
}

function splitLines(source: string): string[] {
	return source.split(/\r?\n/);
}

export function lineText(source: string, line: number): string {
	return splitLines(source)[line - 1] ?? "";
}

export function replaceLine(source: string, line: number, text: string): string {
	const lines = splitLines(source);
	if (line < 1 || line > lines.length) return source;
	lines[line - 1] = text;
	return lines.join("\n");
}

export function removeLine(source: string, line: number): string {
	const lines = splitLines(source);
	if (line < 1 || line > lines.length) return source;
	lines.splice(line - 1, 1);
	return lines.join("\n");
}

export function setPointPosition(source: string, name: string, x: number, y: number): string {
	const lines = splitLines(source);
	for (let index = 0; index < lines.length; index++) {
		const tokens = safeTokens(lines[index] ?? "");
		if (tokens === null) continue;
		const command = tokens[0];
		const pointName = tokens[1];
		if (command?.text !== "point" || command.quoted || pointName?.text !== name || pointName.quoted) continue;
		lines[index] = `point ${name} at ${formatNumber(x)}, ${formatNumber(y)}`;
	}
	return lines.join("\n");
}

export function renamePoint(source: string, oldName: string, newName: string): string {
	const lines = splitLines(source).map((line) => {
		const tokens = safeTokens(line);
		if (tokens === null) return line;
		let changed = false;
		for (const token of tokens) {
			if (!token.quoted && token.text === oldName) {
				token.text = newName;
				changed = true;
			}
		}
		if (!changed) return line;
		return joinTokens(tokens);
	});
	return lines.join("\n");
}

export function lineUsesPoint(line: string, name: string): boolean {
	const tokens = safeTokens(line);
	if (tokens === null) return false;
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (token !== undefined && !token.quoted && token.text === name) return true;
	}
	return false;
}

function splitOptions(line: string, optionStart: number): { head: Token[]; options: Token[] } | null {
	const tokens = safeTokens(line);
	if (tokens === null) return null;
	return { head: tokens.slice(0, optionStart), options: tokens.slice(optionStart) };
}

function wordIndex(options: readonly Token[], word: string): number {
	return options.findIndex((token) => !token.quoted && token.text === word);
}

export function readLabel(line: string, optionStart: number): string | null {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return null;
	const index = wordIndex(parts.options, "label");
	const text = parts.options[index + 1];
	if (index === -1 || text === undefined || !text.quoted) return null;
	return text.text;
}

export function setLabel(line: string, optionStart: number, label: string): string {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return line;
	const options = parts.options;
	const index = wordIndex(options, "label");
	if (index !== -1) options.splice(index, 2);
	const cleaned = label.replace(/"/g, "'");
	if (cleaned !== "") options.push({ text: "label", quoted: false }, { text: cleaned, quoted: true });
	return joinTokens([...parts.head, ...options]);
}

export function hasFlag(line: string, optionStart: number, word: string): boolean {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return false;
	return wordIndex(parts.options, word) !== -1;
}

export function setFlag(line: string, optionStart: number, word: string, on: boolean): string {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return line;
	const options = parts.options.filter((token) => token.quoted || token.text !== word);
	if (on) options.push({ text: word, quoted: false });
	return joinTokens([...parts.head, ...options]);
}

export function readPlacement(line: string, optionStart: number): Placement | null {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return null;
	for (const token of parts.options) {
		if (!token.quoted && PLACEMENT_WORDS.includes(token.text)) return token.text as Placement;
	}
	return null;
}

export function setPlacement(line: string, optionStart: number, placement: Placement | null): string {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return line;
	const options = parts.options.filter((token) => token.quoted || !PLACEMENT_WORDS.includes(token.text));
	if (placement !== null) options.push({ text: placement, quoted: false });
	return joinTokens([...parts.head, ...options]);
}

export function readNumberOption(line: string, optionStart: number, word: string): number | null {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return null;
	const index = wordIndex(parts.options, word);
	const value = parts.options[index + 1];
	if (index === -1 || value === undefined || value.quoted) return null;
	const number = Number(value.text);
	if (!Number.isFinite(number)) return null;
	return number;
}

export function setNumberOption(line: string, optionStart: number, word: string, value: number | null): string {
	const parts = splitOptions(line, optionStart);
	if (parts === null) return line;
	const options = parts.options;
	const index = wordIndex(options, word);
	if (index !== -1) options.splice(index, 2);
	if (value !== null) options.push({ text: word, quoted: false }, { text: formatNumber(value), quoted: false });
	return joinTokens([...parts.head, ...options]);
}

export function setQuotedToken(line: string, index: number, text: string): string {
	const tokens = safeTokens(line);
	const token = tokens?.[index];
	if (tokens === null || token === undefined || !token.quoted) return line;
	token.text = text.replace(/"/g, "'");
	return joinTokens(tokens);
}

export function findDiagramBlocks(text: string): DiagramBlock[] {
	const blocks: DiagramBlock[] = [];
	for (const match of text.matchAll(BLOCK_PATTERN)) {
		const opening = match[0].indexOf("\n") + 1;
		const body = match[1] ?? "";
		const start = (match.index ?? 0) + opening;
		blocks.push({ start, end: start + body.length, source: body.replace(/\r?\n$/, "") });
	}
	return blocks;
}

export function replaceDiagramBlock(text: string, block: DiagramBlock, source: string): string {
	let body = "";
	if (source !== "") body = `${source}\n`;
	return text.slice(0, block.start) + body + text.slice(block.end);
}

export function diagramBlockText(source: string): string {
	if (source === "") return "```examiner-diagram\n```";
	return `\`\`\`examiner-diagram\n${source}\n\`\`\``;
}

export function insertDiagramBlock(text: string, offset: number, source: string): string {
	let before = "";
	if (offset > 0 && text.charAt(offset - 1) !== "\n") before = "\n";
	let after = "";
	if (offset < text.length && text.charAt(offset) !== "\n") after = "\n";
	return text.slice(0, offset) + before + diagramBlockText(source) + after + text.slice(offset);
}

export function replaceNoteBlock(note: string, lineStart: number, lineEnd: number, source: string): string | null {
	const lineBreak = note.includes("\r\n") ? "\r\n" : "\n";
	const lines = note.split(/\r?\n/);
	const opening = lines[lineStart] ?? "";
	const closing = lines[lineEnd] ?? "";
	if (!opening.trimStart().startsWith("```examiner-diagram")) return null;
	if (!closing.trimStart().startsWith("```")) return null;
	const body: string[] = [];
	if (source !== "") body.push(...source.split(/\r?\n/));
	lines.splice(lineStart + 1, lineEnd - lineStart - 1, ...body);
	return lines.join(lineBreak);
}

export interface NewPoint {
	name: string;
	x: number;
	y: number;
}

export function addToDiagram(source: string, points: readonly NewPoint[], shapeLine: string | null): string {
	let lines: string[] = [];
	if (source !== "") lines = splitLines(source);
	while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
	let lastPointLine = -1;
	lines.forEach((line, index) => {
		if (/^\s*point\s/.test(line)) lastPointLine = index;
	});
	const pointLines = points.map((point) => `point ${point.name} at ${formatNumber(point.x)}, ${formatNumber(point.y)}`);
	lines.splice(lastPointLine + 1, 0, ...pointLines);
	if (shapeLine !== null) lines.push(shapeLine);
	return lines.join("\n");
}

export function nextPointName(taken: ReadonlySet<string>): string {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	for (let round = 0; ; round++) {
		for (const letter of letters) {
			let name = letter;
			if (round > 0) name = `${letter}${round}`;
			if (!taken.has(name)) return name;
		}
	}
}

export function nextSymbolName(prefix: string, taken: ReadonlySet<string>): string {
	for (let number = 1; ; number++) {
		const name = `${prefix}${number}`;
		if (!taken.has(name)) return name;
	}
}

function pointLineIndex(lines: readonly string[], name: string): number {
	return lines.findIndex((line) => {
		const tokens = safeTokens(line);
		if (tokens === null) return false;
		const command = tokens[0];
		const pointName = tokens[1];
		return command?.text === "point" && !command.quoted && pointName?.text === name && !pointName.quoted;
	});
}

export function removeShapeLine(source: string, line: number): string {
	return removeSelection(source, [line], []);
}

export function removeSelection(source: string, shapeLines: readonly number[], pointNames: readonly string[]): string {
	const lines = splitLines(source);
	const candidates = new Set<string>(pointNames);
	const descending = [...shapeLines].sort((a, b) => b - a);
	for (const line of descending) {
		const removed = lines[line - 1];
		if (removed === undefined) continue;
		const tokens = safeTokens(removed) ?? [];
		for (const token of tokens.slice(1)) {
			if (!token.quoted) candidates.add(token.text);
		}
		lines.splice(line - 1, 1);
	}
	for (const name of candidates) {
		const definition = pointLineIndex(lines, name);
		if (definition === -1) continue;
		const stillUsed = lines.some((other, index) => index !== definition && lineUsesPoint(other, name));
		if (!stillUsed) lines.splice(definition, 1);
	}
	return lines.join("\n");
}

export function movePoints(source: string, points: readonly NewPoint[]): string {
	let text = source;
	for (const point of points) text = setPointPosition(text, point.name, point.x, point.y);
	return text;
}

export function wordsInLine(line: string): string[] {
	const tokens = safeTokens(line);
	if (tokens === null) return [];
	const words: string[] = [];
	for (const token of tokens.slice(1)) {
		if (!token.quoted) words.push(token.text);
	}
	return words;
}
