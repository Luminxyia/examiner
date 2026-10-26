import { debounce, ItemView, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { answerInstruction } from "../core/answer";
import { itemMarks, markExam, MarkingIncompleteError, pendingMarking, summariseExam, type FlashcardItem } from "../core/exam";
import { awardedMarks, chosenOption, type Judgement } from "../core/flashcard";
import { parseNumberInput } from "../core/numbers";
import { examHistory } from "../core/statistics";
import type { StudyContext } from "../core/study-time";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { toAttemptSummary, type ExamMarking, type ExamResultRecord, type ExamSession } from "../storage/results";
import { OUTCOME_LABELS, renderExamResult } from "./exam-results";
import { confirm, formatMarks, renderEmptyState, renderMarkdown, textButton } from "./shared";

export const VIEW_TYPE_EXAM_SESSION = "examiner-exam-session";

const LOW_TIME_SECONDS = 5 * 60;

const JUDGEMENTS: readonly Judgement[] = ["incorrect", "partial", "correct"];

export class ExamSessionView extends ItemView {
	private session: ExamSession | null = null;
	private result: ExamResultRecord | null = null;
	private loaded = false;
	private submitting = false;
	private timerEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;
	private renderToken = 0;
	private displayedProgress: number | null = null;
	private pendingProgress: { fill: HTMLElement; target: number } | null = null;

	private readonly persist = debounce(() => {
		if (this.session) void this.plugin.results.saveSession(this.session);
	}, 500, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_EXAM_SESSION;
	}

	override getDisplayText(): string {
		const title = this.session?.examTitle ?? this.result?.examTitle;
		return title ? `Exam: ${title}` : "Exam";
	}

	override getIcon(): string {
		return "timer";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-session");
		this.registerInterval(window.setInterval(() => this.tick(), 1000));
		this.register(this.plugin.results.onChange(() => void this.followStore()));
		await this.reload();
	}

	override async onClose(): Promise<void> {
		this.persist.run();
		await Promise.resolve();
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (this.loaded) await this.reload();
		await super.setState(state, result);
	}

	private async followStore(): Promise<void> {
		if (!this.session || this.submitting) return;
		const stored = await this.plugin.results.loadSession();
		if (stored?.startedAt === this.session?.startedAt) return;
		await this.reload();
	}

	private async reload(): Promise<void> {
		this.persist.cancel();
		this.session = await this.plugin.results.loadSession();
		this.loaded = true;
		if (this.session) {
			this.result = null;
			this.session.current = Math.min(Math.max(0, this.session.current), this.session.items.length - 1);
			if (!this.session.attemptId) {
				this.session.attemptId = createId("r");
				await this.plugin.results.saveSession(this.session);
			}
		}
		if (this.session && this.secondsLeft() === 0) {
			await this.submit(true);
			new Notice("Time ran out while the exam was closed. Your saved answers were submitted.");
			return;
		}
		await this.render();
	}

	private takePendingProgress(): { fill: HTMLElement; target: number } | null {
		const pending = this.pendingProgress;
		this.pendingProgress = null;
		return pending;
	}

	private currentProgressWidth(): number | null {
		const fill = this.contentEl.querySelector<HTMLElement>(".examiner-progress-fill");
		const track = fill?.parentElement;
		if (!fill || !track || track.clientWidth === 0) return null;
		return (fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100;
	}

	private secondsLeft(): number | null {
		if (!this.session || this.session.marking || this.session.deadline === null) return null;
		return Math.max(0, Math.ceil((this.session.deadline - Date.now()) / 1000));
	}

	private tick(): void {
		const left = this.secondsLeft();
		if (left === null) return;
		this.updateTimer(left);
		if (left === 0 && !this.submitting) {
			void this.submit(true).then(() => new Notice("Time is up. Your answers have been submitted."));
		}
	}

	private updateTimer(secondsLeft: number): void {
		if (!this.timerEl) return;
		this.timerEl.setText(formatClock(secondsLeft));
		this.timerEl.toggleClass("is-low", secondsLeft <= LOW_TIME_SECONDS);
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		this.displayedProgress = this.currentProgressWidth();
		this.timerEl = null;
		this.navEl = null;
		this.pendingProgress = null;
		const root = createDiv({ cls: "examiner-session-body" });
		if (this.result) {
			await this.renderResults(root, this.result);
		} else if (this.session?.marking) {
			await this.renderMarking(root, this.session, this.session.marking);
		} else if (this.session) {
			await this.renderQuestion(root, this.session);
		} else {
			renderEmptyState(root, "No exam in progress.");
			const open = root.createEl("button", { cls: "mod-cta", text: "Open exams" });
			open.addEventListener("click", () => void this.plugin.openExams());
		}
		if (token !== this.renderToken) return;
		this.contentEl.toggleClass("is-centred", this.result === null);
		this.contentEl.replaceChildren(root);
		const pending = this.takePendingProgress();
		if (pending) {
			pending.fill.getBoundingClientRect();
			pending.fill.setCssProps({ "--examiner-share": `${pending.target}%` });
		}
		root.querySelector<HTMLElement>("[data-autofocus]")?.focus();
		this.plugin.refreshStudyContext();
	}

	studyContext(): StudyContext | null {
		const session = this.session;
		if (!session?.attemptId || session.marking || this.result) return null;
		return { kind: "exam", key: `exam:${session.attemptId}`, examId: session.examId, attemptId: session.attemptId };
	}

	private renderProgress(root: HTMLElement, done: number, total: number, label: string): void {
		const target = (done / total) * 100;
		const progress = root.createDiv({
			cls: "examiner-progress",
			attr: { role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(target)) },
		});
		const fill = progress.createDiv({ cls: "examiner-progress-fill" });
		fill.setCssProps({ "--examiner-share": `${this.displayedProgress ?? target}%` });
		this.pendingProgress = { fill, target };
	}

	private async renderQuestion(root: HTMLElement, session: ExamSession): Promise<void> {
		const index = session.current;
		const item = session.items[index];
		if (!item) return;

		const header = root.createDiv({ cls: "examiner-exam-header" });
		const position = header.createDiv();
		position.createDiv({ cls: "examiner-eyebrow", text: session.examTitle || "Untitled exam" });
		position.createDiv({ cls: "examiner-exam-position", text: `Question ${index + 1} of ${session.items.length}` });
		const timer = header.createDiv({ cls: "examiner-timer" });
		setIcon(timer.createSpan({ cls: "examiner-timer-icon" }), "timer");
		if (session.deadline === null) {
			timer.createSpan({ cls: "examiner-muted", text: "Untimed" });
		} else {
			this.timerEl = timer.createSpan();
			this.updateTimer(this.secondsLeft() ?? 0);
		}

		this.renderProgress(root, index + 1, session.items.length, "Exam progress");

		const card = root.createDiv({ cls: "examiner-question" });
		await renderMarkdown(this.app, card.createDiv({ cls: "examiner-prompt" }), item.kind === "flashcard" ? item.prompt : item.instance.prompt, this);
		const instruction = item.kind === "flashcard" ? null : answerInstruction(item.answerRule);
		if (instruction) card.createDiv({ cls: "examiner-instruction", text: instruction });

		const dontKnow = (session.dontKnow ??= session.items.map(() => false));
		const placeholder = () => (dontKnow[index] ? "Marked as I don't know" : "Your answer");
		let input: HTMLInputElement | HTMLTextAreaElement | null = null;
		if (item.kind === "flashcard" && item.mode === "choice") {
			this.renderChoices(card, session, item, index);
		} else if (item.kind === "flashcard") {
			input = card.createEl("textarea", { cls: "examiner-textarea examiner-answer-text", attr: { rows: "4", "aria-label": "Your answer" } });
		}

		const answerRow = card.createDiv({ cls: "examiner-answer-form" });
		answerRow.toggleClass("is-actions", item.kind === "flashcard");
		if (item.kind !== "flashcard") {
			input = answerRow.createEl("input", {
				type: "text",
				cls: "examiner-answer-input",
				attr: { "aria-label": "Your answer", inputmode: "decimal", autocomplete: "off" },
			});
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && index < session.items.length - 1) void this.goTo(index + 1);
			});
		}
		const previous = textButton(answerRow, "Previous");
		previous.disabled = index === 0;
		previous.addEventListener("click", () => void this.goTo(index - 1));
		const unsure = answerRow.createEl("button", {
			cls: "examiner-dont-know",
			text: "I don't know",
			attr: { "aria-pressed": String(Boolean(dontKnow[index])) },
		});
		unsure.toggleClass("is-active", Boolean(dontKnow[index]));
		unsure.addEventListener("click", () => void this.toggleDontKnow(index));

		if (input) {
			const field = input;
			field.value = dontKnow[index] ? "" : (session.responses[index] ?? "");
			field.placeholder = placeholder();
			field.dataset.autofocus = "";
			const message = item.kind === "flashcard" ? null : card.createDiv({ cls: "examiner-warning-text examiner-input-message" });
			const showFormat = () => {
				if (!message) return;
				const text = field.value.trim();
				const parsed = parseNumberInput(text);
				message.setText(text !== "" && !parsed.ok ? `${parsed.message} It will be marked incorrect.` : "");
			};
			showFormat();
			field.addEventListener("input", () => {
				session.responses[index] = field.value;
				if (dontKnow[index] && field.value.trim() !== "") {
					dontKnow[index] = false;
					unsure.removeClass("is-active");
					unsure.setAttribute("aria-pressed", "false");
					field.placeholder = placeholder();
				}
				showFormat();
				this.renderNav(session);
				this.persist();
			});
		}

		if (index === session.items.length - 1) {
			const submit = textButton(answerRow, "Submit exam", true);
			submit.addEventListener("click", () => void this.confirmSubmit());
		} else {
			const next = textButton(answerRow, "Next", true);
			next.addEventListener("click", () => void this.goTo(index + 1));
		}

		this.navEl = root.createDiv({ cls: "examiner-session-nav", attr: { role: "navigation", "aria-label": "Questions" } });
		this.renderNav(session);
	}

	private renderChoices(parent: HTMLElement, session: ExamSession, item: FlashcardItem, index: number): void {
		const list = parent.createDiv({ cls: "examiner-choices", attr: { role: "radiogroup", "aria-label": "Options" } });
		const selected = session.dontKnow?.[index] ? null : chosenOption(session.responses[index], item.options.length);
		item.options.forEach((option, optionIndex) => {
			const isSelected = selected === optionIndex;
			const button = list.createEl("button", {
				cls: "examiner-choice",
				attr: { role: "radio", "aria-checked": String(isSelected) },
			});
			button.toggleClass("is-selected", isSelected);
			button.createSpan({ cls: "examiner-choice-key", text: String.fromCharCode(65 + (optionIndex % 26)) });
			button.createSpan({ cls: "examiner-choice-text", text: option });
			if (optionIndex === (selected ?? 0)) button.dataset.autofocus = "";
			button.addEventListener("click", () => {
				session.responses[index] = String(optionIndex);
				if (session.dontKnow) session.dontKnow[index] = false;
				this.persist();
				void this.render();
			});
		});
	}

	private async toggleDontKnow(index: number): Promise<void> {
		const session = this.session;
		if (!session) return;
		const dontKnow = (session.dontKnow ??= session.items.map(() => false));
		dontKnow[index] = !dontKnow[index];
		if (dontKnow[index]) session.responses[index] = "";
		this.persist();
		if (dontKnow[index] && index < session.items.length - 1) await this.goTo(index + 1);
		else await this.render();
	}

	private renderNav(session: ExamSession): void {
		const nav = this.navEl;
		if (!nav) return;
		nav.empty();
		session.items.forEach((_item, index) => {
			const unknown = Boolean(session.dontKnow?.[index]);
			const answered = !unknown && (session.responses[index] ?? "").trim() !== "";
			const state = unknown ? ", marked I don't know" : answered ? ", answered" : "";
			const button = nav.createEl("button", {
				cls: "examiner-nav-button",
				text: String(index + 1),
				attr: { "aria-label": `Question ${index + 1}${state}` },
			});
			button.toggleClass("is-answered", answered);
			button.toggleClass("is-unknown", unknown);
			button.toggleClass("is-current", index === session.current);
			if (index === session.current) button.setAttribute("aria-current", "step");
			button.addEventListener("click", () => void this.goTo(index));
		});
	}

	private async goTo(index: number): Promise<void> {
		if (!this.session || index < 0 || index >= this.session.items.length) return;
		this.session.current = index;
		this.persist();
		await this.render();
	}

	private async confirmSubmit(): Promise<void> {
		if (!this.session) return;
		const session = this.session;
		const unanswered = session.responses.filter((response, index) => response.trim() === "" && !session.dontKnow?.[index]).length;
		const toMark = pendingMarking(session.items, session.responses, session.dontKnow).length;
		const lines = [
			unanswered === 0 ? "You have answered every question." : `${unanswered === 1 ? "1 question is" : `${unanswered} questions are`} unanswered.`,
			"Answers cannot be changed after submitting.",
		];
		if (toMark > 0) lines.push(`You will then mark ${toMark === 1 ? "1 written answer" : `${toMark} written answers`}.`);
		const confirmed = await confirm(this.app, { title: "Submit exam?", message: lines.join(" "), confirmText: "Submit" });
		if (confirmed) await this.submit(false);
	}

	private async submit(timedOut: boolean): Promise<void> {
		const session = this.session;
		if (!session || session.marking || this.submitting) return;
		this.submitting = true;
		try {
			this.persist.cancel();
			const attemptId = (session.attemptId ??= createId("r"));
			const marking: ExamMarking = {
				submittedAt: new Date().toISOString(),
				timedOut,
				activeMs: await this.plugin.endStudyAndMeasure(attemptId),
				judgements: session.items.map(() => null),
				current: 0,
			};
			const pending = pendingMarking(session.items, session.responses, session.dontKnow);
			if (pending.length === 0) {
				await this.finish(session, marking);
				return;
			}
			marking.current = pending[0] ?? 0;
			session.marking = marking;
			try {
				await this.plugin.results.saveSession(session);
			} catch (error) {
				console.error("Examiner: could not save the exam session", error);
			}
			await this.render();
		} finally {
			this.submitting = false;
		}
	}

	private async completeMarking(session: ExamSession, marking: ExamMarking): Promise<void> {
		if (this.submitting) return;
		this.submitting = true;
		try {
			await this.finish(session, marking);
		} finally {
			this.submitting = false;
		}
	}

	private async finish(session: ExamSession, marking: ExamMarking): Promise<void> {
		this.persist.cancel();
		const attemptId = session.attemptId ?? createId("r");
		let items;
		try {
			items = markExam(session.items, session.responses, session.dontKnow, marking.judgements);
		} catch (error) {
			if (!(error instanceof MarkingIncompleteError)) throw error;
			new Notice(error.message);
			return;
		}
		let record: ExamResultRecord = {
			version: 1,
			id: attemptId,
			examId: session.examId,
			examTitle: session.examTitle,
			startedAt: session.startedAt,
			submittedAt: marking.submittedAt,
			timeLimitMinutes: session.timeLimitMinutes,
			timedOut: marking.timedOut,
			items,
			summary: summariseExam(items),
			activeMs: marking.activeMs,
		};
		try {
			const added = await this.plugin.results.recordExamResult(record);
			if (!added) {
				const existing = (await this.plugin.results.readExamResults()).find((result) => result.id === attemptId);
				if (existing) record = existing;
			}
			await this.plugin.results.clearSession();
		} catch (error) {
			console.error("Examiner: could not save the exam result", error);
			new Notice("The exam was marked, but the result could not be saved. Your answers are still saved, so you can submit again.");
			return;
		}
		this.session = null;
		this.result = record;
		await this.render();
	}

	private async renderMarking(root: HTMLElement, session: ExamSession, marking: ExamMarking): Promise<void> {
		const pending = pendingMarking(session.items, session.responses, session.dontKnow);
		if (!pending.includes(marking.current)) marking.current = pending[0] ?? 0;
		const index = marking.current;
		const item = session.items[index];
		const position = pending.indexOf(index);
		const remaining = pending.filter((pendingIndex) => !marking.judgements[pendingIndex]).length;

		const header = root.createDiv({ cls: "examiner-exam-header" });
		const heading = header.createDiv();
		heading.createDiv({ cls: "examiner-eyebrow", text: session.examTitle || "Untitled exam" });
		heading.createDiv({ cls: "examiner-exam-position", text: `Marking answer ${position + 1} of ${pending.length}` });
		header.createDiv({
			cls: "examiner-muted examiner-small",
			text: remaining === 0 ? "All answers marked" : `${remaining} left to mark`,
		});
		this.renderProgress(root, pending.length - remaining, pending.length, "Marking progress");

		if (!item || item.kind !== "flashcard") return;
		const marks = itemMarks(item);
		const card = root.createDiv({ cls: "examiner-question" });
		await renderMarkdown(this.app, card.createDiv({ cls: "examiner-prompt" }), item.prompt, this);
		const comparison = card.createEl("dl", { cls: "examiner-comparison" });
		comparison.createEl("dt", { text: "Your answer" });
		comparison.createEl("dd", { text: (session.responses[index] ?? "").trim() });
		comparison.createEl("dt", { text: "Expected answer" });
		comparison.createEl("dd", { text: item.answer });
		comparison.createEl("dt", { text: "Marks" });
		comparison.createEl("dd", { text: formatMarks(marks) });

		const current = marking.judgements[index] ?? null;
		const choices = card.createDiv({ cls: "examiner-judgements", attr: { role: "group", "aria-label": "Mark this answer" } });
		for (const judgement of JUDGEMENTS) {
			const awarded = formatMarks(awardedMarks(judgement, marks));
			const button = choices.createEl("button", {
				cls: `examiner-judgement examiner-tone-${judgement === "correct" ? "success" : judgement === "partial" ? "warning" : "error"}`,
				text: OUTCOME_LABELS[judgement],
				attr: { "aria-pressed": String(current === judgement), "aria-label": `${OUTCOME_LABELS[judgement]}, ${awarded} ${awarded === "1" ? "mark" : "marks"}` },
			});
			button.toggleClass("is-active", current === judgement);
			if (judgement === (current ?? "correct")) button.dataset.autofocus = "";
			button.addEventListener("click", () => void this.judge(session, marking, index, judgement));
		}

		const footer = root.createDiv({ cls: "examiner-answer-form is-actions" });
		const previous = textButton(footer, "Previous");
		previous.disabled = position <= 0;
		previous.addEventListener("click", () => void this.moveMarking(marking, pending[position - 1]));
		const next = textButton(footer, "Next");
		next.disabled = position >= pending.length - 1;
		next.addEventListener("click", () => void this.moveMarking(marking, pending[position + 1]));
		const finish = textButton(footer, "Finish marking", true);
		finish.disabled = remaining > 0;
		finish.addEventListener("click", () => void this.completeMarking(session, marking));

		this.navEl = root.createDiv({ cls: "examiner-session-nav", attr: { role: "navigation", "aria-label": "Answers to mark" } });
		pending.forEach((pendingIndex, number) => {
			const judgement = marking.judgements[pendingIndex];
			const button = this.navEl?.createEl("button", {
				cls: "examiner-nav-button",
				text: String(number + 1),
				attr: { "aria-label": `Answer ${number + 1}${judgement ? `, ${OUTCOME_LABELS[judgement].toLowerCase()}` : ", not marked"}` },
			});
			if (!button) return;
			button.toggleClass("is-answered", Boolean(judgement));
			button.toggleClass("is-current", pendingIndex === index);
			if (pendingIndex === index) button.setAttribute("aria-current", "step");
			button.addEventListener("click", () => void this.moveMarking(marking, pendingIndex));
		});
	}

	private async judge(session: ExamSession, marking: ExamMarking, index: number, judgement: Judgement): Promise<void> {
		marking.judgements[index] = judgement;
		const pending = pendingMarking(session.items, session.responses, session.dontKnow);
		const after = pending.slice(pending.indexOf(index) + 1);
		const nextUnmarked = after.find((pendingIndex) => !marking.judgements[pendingIndex]);
		if (nextUnmarked !== undefined) marking.current = nextUnmarked;
		this.persist();
		await this.render();
	}

	private async moveMarking(marking: ExamMarking, index: number | undefined): Promise<void> {
		if (index === undefined) return;
		marking.current = index;
		this.persist();
		await this.render();
	}

	private async renderResults(root: HTMLElement, record: ExamResultRecord): Promise<void> {
		const attempts = (await this.plugin.results.readExamResults()).map(toAttemptSummary);
		const numbered = examHistory(attempts, record.examId).find((attempt) => attempt.id === record.id);
		await renderExamResult(this.app, this, root, record, {
			attemptLabel: numbered ? `Attempt ${numbered.attemptNumber}` : undefined,
			backLabel: "Back to exams",
			onBack: () => void this.plugin.openExams(),
		});
	}
}

function formatClock(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
