import { MarkdownRenderer, Modal, setIcon, Setting, setTooltip, type App, type Component, type WorkspaceLeaf } from "obsidian";
import type ExaminerPlugin from "../main";

export async function renderMarkdown(app: App, container: HTMLElement, markdown: string, component: Component): Promise<void> {
	container.empty();
	await MarkdownRenderer.render(app, markdown, container, "", component);
}

export function renderTags(container: HTMLElement, tags: readonly string[]): void {
	if (tags.length === 0) return;
	const list = container.createDiv({ cls: "examiner-tags" });
	for (const tag of tags) list.createSpan({ cls: "examiner-tag", text: tag });
}

export function section(parent: HTMLElement, title: string, note?: string, controls?: (heading: HTMLElement) => void): HTMLElement {
	const element = parent.createDiv({ cls: "examiner-block" });
	const heading = element.createDiv({ cls: "examiner-block-heading" });
	heading.createSpan({ cls: "examiner-block-title", text: title });
	if (note) heading.createSpan({ cls: "examiner-block-note", text: note });
	controls?.(heading);
	return element;
}

export function renderAnswerComparison(parent: HTMLElement, response: string, expected: string, note?: string): void {
	const list = parent.createEl("dl", { cls: "examiner-comparison" });
	list.createEl("dt", { text: "Your answer" });
	list.createEl("dd", { text: response });
	list.createEl("dt", { text: "Expected" });
	list.createEl("dd", { text: expected });
	if (note) parent.createDiv({ cls: "examiner-muted examiner-small", text: note });
}

export function renderWorking(parent: HTMLElement, lines: readonly string[], open: boolean): void {
	if (lines.length === 0) return;
	const details = parent.createEl("details", { cls: "examiner-working" });
	details.open = open;
	details.createEl("summary", { text: "Working" });
	const list = details.createEl("ol");
	for (const line of lines) list.createEl("li", { text: line });
}

export type Tone = "success" | "error" | "warning" | "muted";

export function textButton(parent: HTMLElement, label: string, primary = false): HTMLButtonElement {
	return parent.createEl("button", { cls: primary ? "mod-cta" : "", text: label });
}

export function iconAction(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
	const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
	setIcon(button, icon);
	setTooltip(button, label);
	return button;
}

export function renderEmptyState(container: HTMLElement, message: string): HTMLElement {
	return container.createDiv({ cls: "examiner-empty", text: message });
}

export function renderLoadState(container: HTMLElement, plugin: ExaminerPlugin, loadingText = "Loading questions…"): void {
	const error = plugin.loadState.error;
	if (error === null) {
		container.createSpan({ cls: "examiner-muted", text: loadingText });

		return;
	}
	const state = container.createDiv({ cls: "examiner-load-error" });
	state.createDiv({ cls: "examiner-error-text", text: `Examiner could not read its questions and exams: ${error}` });
	const retry = textButton(state, "Try again");
	retry.addEventListener("click", () => {
		retry.disabled = true;
		void plugin.loadLibraries();
	});
}

interface ConfirmOptions {
	title: string;
	message: string | DocumentFragment;
	confirmText: string;
	cancelText?: string;
	destructive?: boolean;
}

export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}

class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.options.title);
		if (typeof this.options.message === "string") this.contentEl.createEl("p", { text: this.options.message });
		else this.contentEl.append(this.options.message);
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.options.cancelText ?? "Cancel").onClick(() => this.close()))
			.addButton((button) => {
				button.setButtonText(this.options.confirmText).onClick(() => {
					this.confirmed = true;
					this.close();
				});
				if (this.options.destructive) button.setDestructive();
				else button.setCta();
			});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.resolve(this.confirmed);
	}
}

export type ExaminerSection = "overview" | "tutor" | "exams" | "questions";

const SECTIONS: { id: ExaminerSection; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "tutor", label: "Tutor" },
	{ id: "exams", label: "Exams" },
	{ id: "questions", label: "Questions" },
];

export function renderSectionNav(parent: HTMLElement, plugin: ExaminerPlugin, leaf: WorkspaceLeaf, current: ExaminerSection): void {
	const nav = parent.createEl("nav", { cls: "examiner-section-nav" });
	for (const section of SECTIONS) {
		const button = nav.createEl("button", { text: section.label });
		if (section.id === current) {
			button.addClass("is-active");
			button.setAttribute("aria-current", "page");
			continue;
		}
		button.addEventListener("click", () => void plugin.showSection(leaf, section.id));
	}
}

export function renderStudyTimerButton(parent: HTMLElement, plugin: ExaminerPlugin): HTMLButtonElement {
	const button = textButton(parent, "");
	button.addEventListener("click", () => void plugin.toggleStudyTimer());
	updateStudyTimerButton(button, plugin);
	return button;
}

export function updateStudyTimerButton(button: HTMLButtonElement, plugin: ExaminerPlugin): void {
	const startedAt = plugin.studyTimerStartedAt;
	button.toggleClass("mod-cta", startedAt !== null);
	if (startedAt === null) {
		button.setText("Start study timer");
		return;
	}
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	button.setText(`Stop study timer · ${formatClock(elapsedSeconds)}`);
}

export function formatClock(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const seconds = (Date.parse(iso) - now) / 1000;
	if (Math.abs(seconds) < 45) return "just now";
	const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["year", 31_536_000],
		["month", 2_592_000],
		["week", 604_800],
		["day", 86_400],
		["hour", 3_600],
		["minute", 60],
	];
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
	}
	return format.format(Math.round(seconds / 60), "minute");
}

export function formatMarks(value: number): string {
	return String(Math.round(value * 100) / 100);
}

export function formatScore(marks: number, maxMarks: number): string {
	return `${formatMarks(marks)}/${formatMarks(maxMarks)}`;
}

export function formatPercent(value: number): string {
	return `${Math.round(value * 10) / 10}%`;
}
