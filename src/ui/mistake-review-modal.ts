import { Component, Modal, Setting } from "obsidian";
import { workedSteps } from "../core/generate";
import { describeMisses, type MistakeEntry } from "../core/insights";
import type ExaminerPlugin from "../main";
import { formatDateTime, renderAnswerComparison, renderMarkdown, renderTags, renderWorking } from "./shared";

export class MistakeReviewModal extends Modal {
	private renderToken = 0;
	private readonly component = new Component();

	constructor(
		private readonly plugin: ExaminerPlugin,
		private readonly mistakes: readonly MistakeEntry[],
		private index: number,
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		this.modalEl.addClass("examiner-review-modal");
		this.component.load();
		void this.render();
	}

	override onClose(): void {
		this.renderToken++;
		this.component.unload();
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const mistake = this.mistakes[this.index];
		if (!mistake) return;
		const { contentEl } = this;
		const body = createDiv({ cls: "examiner-review-modal-body" });
		const { example } = mistake;
		this.setTitle(mistake.title || "Untitled question");

		const details = [mistake.examTitle || "Untitled exam", describeMisses(mistake), `last on ${formatDateTime(mistake.lastMissedAt)}`];
		if (mistake.correctSinceLastMiss) details.push("answered correctly since");
		body.createDiv({ cls: "examiner-muted examiner-small", text: details.join(" · ") });

		await renderMarkdown(this.app, body.createDiv({ cls: "examiner-prompt" }), example.prompt, this.component);
		if (token !== this.renderToken) return;
		if (example.instruction) body.createDiv({ cls: "examiner-instruction", text: example.instruction });
		renderAnswerComparison(body, example.response === "" ? "No answer" : example.response, example.expectedDisplay, example.note);
		renderWorking(body, workedSteps({ inputs: example.inputs, steps: example.steps }), true);
		renderTags(body, mistake.tags);

		const question = this.plugin.questions.get(mistake.questionId);
		const usable = question !== undefined && this.plugin.questionIsUsable(question);
		if (!usable) {
			body.createDiv({
				cls: "examiner-muted examiner-small",
				text: question ? "This question has errors, so it can't be practiced until it is fixed." : "This question has been deleted, so it can't be practiced.",
			});
		}

		const footer = new Setting(body).setClass("examiner-review-modal-footer");
		if (this.mistakes.length > 1) {
			footer.setDesc(`${this.index + 1} of ${this.mistakes.length}`);
			footer.addButton((button) =>
				button
					.setButtonText("Previous")
					.setDisabled(this.index === 0)
					.onClick(() => this.move(-1)),
			);
			footer.addButton((button) =>
				button
					.setButtonText("Next")
					.setDisabled(this.index === this.mistakes.length - 1)
					.onClick(() => this.move(1)),
			);
		}
		footer.addButton((button) =>
			button
				.setButtonText("Practice again")
				.setCta()
				.setDisabled(!usable)
				.onClick(() => {
					this.close();
					void this.plugin.openPractice(mistake.questionId);
				}),
		);
		if (token !== this.renderToken) return;
		contentEl.replaceChildren(body);
	}

	private move(offset: number): void {
		const next = this.index + offset;
		if (next < 0 || next >= this.mistakes.length) return;
		this.index = next;
		void this.render();
	}
}
