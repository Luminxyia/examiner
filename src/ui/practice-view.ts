import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { answerInstruction, checkAnswer, formatExpectedAnswer, type AnswerCheck } from "../core/answer";
import { hasErrors, validateDefinition, type QuestionDefinition } from "../core/definition";
import { drawFlashcard, expectedFlashcardAnswer, type FlashcardCard, type Judgement } from "../core/flashcard";
import { GenerationError, generateInstance, workedSteps, type QuestionInstance } from "../core/generate";
import { parseNumberInput } from "../core/numbers";
import type { StudyContext } from "../core/study-time";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import type { PracticeAttemptRecord } from "../storage/results";
import { iconAction, renderAnswerComparison, renderEmptyState, renderLoadState, renderMarkdown, renderTags, renderWorking, textButton } from "./shared";

export const VIEW_TYPE_PRACTICE = "examiner-practice";

export interface PracticeViewState {
	questionId?: string;
}

interface Submission {
	response: string;
	check: AnswerCheck;
	revealed: boolean;
}

interface FlashcardAttempt {
	response: string;
	outcome: Judgement | null;
}

const JUDGEMENT_LABELS: Record<Judgement, string> = {
	incorrect: "Incorrect",
	partial: "Partially correct",
	correct: "Correct",
};

const JUDGEMENT_TONES: Record<Judgement, string> = {
	incorrect: "error",
	partial: "warning",
	correct: "success",
};

export class PracticeView extends ItemView {
	private questionId: string | null = null;
	private instance: QuestionInstance | null = null;
	private card: FlashcardCard | null = null;
	private submission: Submission | null = null;
	private attempt: FlashcardAttempt | null = null;
	private tally = { correct: 0, total: 0 };
	private renderToken = 0;
	private generatedFrom = "";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_PRACTICE;
	}

	override getDisplayText(): string {
		const question = this.question();
		return question ? `Practice: ${question.title || "Untitled question"}` : "Practice";
	}

	override getIcon(): string {
		return "graduation-cap";
	}

	override getState(): Record<string, unknown> {
		const state: PracticeViewState = this.questionId ? { questionId: this.questionId } : {};
		return { ...state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const questionId = (state as PracticeViewState | null)?.questionId ?? null;
		if (questionId !== this.questionId) {
			this.questionId = questionId;
			this.tally = { correct: 0, total: 0 };
			this.newVariation();
		}
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-practice");
		this.register(
			this.plugin.questions.onChange(() => {
				const question = this.question();
				if ((!this.instance && !this.card) || JSON.stringify(question) !== this.generatedFrom) this.newVariation();
				else void this.render();
			}),
		);
		this.register(
			this.plugin.loadState.onChange(() => {
				if (this.plugin.ready && !this.instance && !this.card) this.newVariation();
				else void this.render();
			}),
		);
		await this.render();
	}

	private question(): QuestionDefinition | undefined {
		return this.questionId === null ? undefined : this.plugin.questions.get(this.questionId);
	}

	private newVariation(): void {
		this.submission = null;
		this.attempt = null;
		this.instance = null;
		this.card = null;
		const question = this.question();
		this.generatedFrom = JSON.stringify(question);
		if (question?.kind === "flashcard") {
			if (!hasErrors(validateDefinition(question))) this.card = drawFlashcard(question);
		} else if (question && !hasErrors(validateDefinition(question))) {
			try {
				this.instance = generateInstance(question);
			} catch (error) {
				if (!(error instanceof GenerationError)) throw error;
				new Notice(error.message);
			}
		}
		void this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = createDiv({ cls: "examiner-practice-body" });

		if (!this.plugin.ready) {
			renderLoadState(root.createDiv({ cls: "examiner-empty" }), this.plugin);
			return this.show(root, token);
		}

		const question = this.question();
		if (!question) {
			renderEmptyState(root, this.questionId === null ? "No question selected." : "This question no longer exists.");
			this.chooseButton(root);
			return this.show(root, token);
		}

		const header = root.createDiv({ cls: "examiner-page-header" });
		const heading = header.createDiv({ cls: "examiner-page-heading" });
		heading.createDiv({ cls: "examiner-eyebrow", text: "Practice" });
		heading.createEl("h2", { cls: "examiner-heading", text: question.title || "Untitled question" });
		const actions = header.createDiv({ cls: "examiner-header-actions" });
		this.chooseButton(actions);
		const edit = iconAction(actions, "square-pen", "Edit question");
		edit.addEventListener("click", () => void this.plugin.openQuestionEditor(question.id));
		if (question.tags.length > 0 || this.tally.total > 0) {
			const meta = root.createDiv({ cls: "examiner-meta-row" });
			renderTags(meta, question.tags);
			if (this.tally.total > 0) {
				meta.createSpan({
					cls: "examiner-muted examiner-small",
					text: `${this.tally.correct} of ${this.tally.total} correct this session`,
				});
			}
		}

		if (hasErrors(validateDefinition(question))) {
			renderEmptyState(root, "This question has errors. Fix them in the editor to practice it.");
			return this.show(root, token);
		}
		if (this.card) {
			const surface = root.createDiv({ cls: "examiner-question" });
			await renderMarkdown(this.app, surface.createDiv({ cls: "examiner-prompt" }), this.card.prompt, this);
			if (token !== this.renderToken) return;
			this.renderFlashcard(surface, question, this.card);
			return this.show(root, token);
		}
		const instance = this.instance;
		if (!instance) {
			renderEmptyState(root, "A question could not be generated from this definition. Check its steps in the editor.");
			return this.show(root, token);
		}

		const card = root.createDiv({ cls: "examiner-question" });
		await renderMarkdown(this.app, card.createDiv({ cls: "examiner-prompt" }), instance.prompt, this);
		if (token !== this.renderToken) return;
		const instruction = answerInstruction(question.answer);
		if (instruction) card.createDiv({ cls: "examiner-instruction", text: instruction });

		this.renderAnswerForm(card, question, instance);
		this.show(root, token);
	}

	private show(root: HTMLElement, token: number): void {
		if (token !== this.renderToken) return;
		this.contentEl.replaceChildren(root);
		root.querySelector<HTMLElement>("[data-autofocus]")?.focus();
		this.plugin.refreshStudyContext();
	}

	studyContext(): StudyContext | null {
		if (!this.questionId || (!this.instance && !this.card)) return null;
		return { kind: "practice", key: `practice:${this.questionId}`, questionId: this.questionId };
	}

	private chooseButton(parent: HTMLElement): void {
		const button = textButton(parent, "Choose question");
		button.addEventListener("click", () => this.plugin.choosePracticeQuestion());
	}

	private renderAnswerForm(parent: HTMLElement, question: QuestionDefinition, instance: QuestionInstance): void {
		const form = parent.createEl("form", { cls: "examiner-answer-form" });
		const input = form.createEl("input", {
			type: "text",
			cls: "examiner-answer-input",
			attr: { "aria-label": "Your answer", placeholder: "Your answer", inputmode: "decimal", autocomplete: "off" },
		});
		const submit = textButton(form, "Check", true);
		submit.type = "submit";
		const message = parent.createDiv({ cls: "examiner-error-text examiner-input-message" });

		if (this.submission) {
			input.value = this.submission.response;
			input.disabled = true;
			submit.disabled = true;
			this.renderFeedback(parent, question, instance, this.submission);
			return;
		}

		input.dataset.autofocus = "";
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const parsed = parseNumberInput(input.value);
			if (!parsed.ok) {
				message.setText(parsed.message);
				input.addClass("examiner-invalid");
				return;
			}
			const check = checkAnswer(question.answer, instance.answer, parsed.value);
			this.submission = { response: input.value.trim(), check, revealed: check.correct };
			this.tally.total++;
			if (check.correct) this.tally.correct++;
			void this.record(question, instance, this.submission);
			void this.render();
		});
		input.addEventListener("input", () => {
			message.empty();
			input.removeClass("examiner-invalid");
		});
	}

	private renderFeedback(parent: HTMLElement, question: QuestionDefinition, instance: QuestionInstance, submission: Submission): void {
		const { correct } = submission.check;
		const feedback = parent.createDiv({ cls: "examiner-feedback" });
		feedback.createDiv({
			cls: `examiner-feedback-status examiner-tone-${correct ? "success" : "error"}`,
			text: correct ? "Correct" : "Incorrect",
		});
		if (submission.check.hint) feedback.createDiv({ cls: "examiner-small", text: submission.check.hint });

		if (submission.revealed) {
			renderAnswerComparison(feedback, submission.response, formatExpectedAnswer(question.answer, instance.answer));
			renderWorking(feedback, workedSteps(instance), !correct);
		}

		const actions = parent.createDiv({ cls: "examiner-feedback-actions" });
		if (!submission.check.correct) {
			const retry = textButton(actions, "Try again");
			retry.addEventListener("click", () => {
				this.submission = null;
				void this.render();
			});
			if (!submission.revealed) {
				const reveal = textButton(actions, "Show answer");
				reveal.addEventListener("click", () => {
					submission.revealed = true;
					void this.render();
				});
			}
		}
		const next = textButton(actions, "New variation", true);
		next.dataset.autofocus = "";
		next.addEventListener("click", () => this.newVariation());
	}

	private renderFlashcard(parent: HTMLElement, question: QuestionDefinition, card: FlashcardCard): void {
		const attempt = this.attempt;
		if (card.mode === "choice") {
			const list = parent.createDiv({ cls: "examiner-choices", attr: { role: "radiogroup", "aria-label": "Options" } });
			card.options.forEach((option, index) => {
				const chosen = attempt?.response === option;
				const button = list.createEl("button", { cls: "examiner-choice", attr: { role: "radio", "aria-checked": String(chosen) } });
				button.toggleClass("is-selected", chosen);
				button.createSpan({ cls: "examiner-choice-key", text: String.fromCharCode(65 + (index % 26)) });
				button.createSpan({ cls: "examiner-choice-text", text: option });
				button.disabled = attempt !== null;
				if (index === 0) button.dataset.autofocus = "";
				button.addEventListener("click", () => this.judgeFlashcard(question, card, option, index === card.correct ? "correct" : "incorrect"));
			});
		} else {
			const area = parent.createEl("textarea", { cls: "examiner-textarea examiner-answer-text", attr: { rows: "4", "aria-label": "Your answer", placeholder: "Your answer" } });
			area.value = attempt?.response ?? "";
			area.disabled = attempt !== null;
			if (!attempt) {
				area.dataset.autofocus = "";
				const actions = parent.createDiv({ cls: "examiner-answer-form is-actions" });
				textButton(actions, "Show answer", true).addEventListener("click", () => {
					this.attempt = { response: area.value.trim(), outcome: null };
					void this.render();
				});
			}
		}
		if (!attempt) return;

		const feedback = parent.createDiv({ cls: "examiner-feedback" });
		if (attempt.outcome) {
			feedback.createDiv({
				cls: `examiner-feedback-status examiner-tone-${JUDGEMENT_TONES[attempt.outcome]}`,
				text: JUDGEMENT_LABELS[attempt.outcome],
			});
		}
		renderAnswerComparison(feedback, attempt.response === "" ? "No answer" : attempt.response, expectedFlashcardAnswer(card));

		const actions = parent.createDiv({ cls: "examiner-feedback-actions" });
		if (attempt.outcome === null) {
			const choices = actions.createDiv({ cls: "examiner-judgements", attr: { role: "group", "aria-label": "Mark this answer" } });
			for (const judgement of ["incorrect", "partial", "correct"] as const) {
				const button = choices.createEl("button", {
					cls: `examiner-judgement examiner-tone-${JUDGEMENT_TONES[judgement]}`,
					text: JUDGEMENT_LABELS[judgement],
				});
				if (judgement === "correct") button.dataset.autofocus = "";
				button.addEventListener("click", () => this.judgeFlashcard(question, card, attempt.response, judgement));
			}
			return;
		}
		if (attempt.outcome !== "correct" && card.mode === "choice") {
			textButton(actions, "Try again").addEventListener("click", () => {
				this.attempt = null;
				void this.render();
			});
		}
		const again = textButton(actions, "Practice again", true);
		again.dataset.autofocus = "";
		again.addEventListener("click", () => this.newVariation());
	}

	private judgeFlashcard(question: QuestionDefinition, card: FlashcardCard, response: string, outcome: Judgement): void {
		this.attempt = { response, outcome };
		this.tally.total++;
		if (outcome === "correct") this.tally.correct++;
		void this.recordFlashcard(question, card, response, outcome);
		void this.render();
	}

	private async recordFlashcard(question: QuestionDefinition, card: FlashcardCard, response: string, outcome: Judgement): Promise<void> {
		await this.save({
			version: 1,
			id: createId("a"),
			kind: "flashcard",
			questionId: question.id,
			questionTitle: question.title,
			tags: [...question.tags],
			submittedAt: new Date().toISOString(),
			prompt: card.prompt,
			inputs: {},
			steps: [],
			answer: Number.NaN,
			expectedDisplay: expectedFlashcardAnswer(card),
			response,
			correct: outcome === "correct",
			outcome,
		});
	}

	private async save(record: PracticeAttemptRecord): Promise<void> {
		try {
			await this.plugin.results.recordPracticeAttempt(record);
		} catch (error) {
			console.error("Examiner: could not record the attempt", error);
			new Notice("Your answer was checked, but the attempt could not be saved.");
		}
	}

	private async record(question: QuestionDefinition, instance: QuestionInstance, submission: Submission): Promise<void> {
		const record: PracticeAttemptRecord = {
			version: 1,
			id: createId("a"),
			questionId: question.id,
			questionTitle: question.title,
			tags: [...question.tags],
			submittedAt: new Date().toISOString(),
			prompt: instance.prompt,
			inputs: instance.inputs,
			steps: instance.steps,
			answer: instance.answer,
			expectedDisplay: formatExpectedAnswer(question.answer, instance.answer),
			response: submission.response,
			correct: submission.check.correct,
		};
		await this.save(record);
	}
}
