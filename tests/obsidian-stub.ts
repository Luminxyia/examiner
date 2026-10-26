import { parse, stringify } from "yaml";

export function parseYaml(text: string): unknown {
	return parse(text);
}

export function stringifyYaml(value: unknown): string {
	return stringify(value);
}

export const notices: string[] = [];

export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
}

export class Modal {}

export class Setting {}

export class TFile {
	path = "";
	stat = { size: 0 };
}

export class TFolder {
	path = "";
	children: (TFile | TFolder)[] = [];
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export const MarkdownRenderer = {};

export function setIcon(): void {}

export function setTooltip(): void {}
