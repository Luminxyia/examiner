import { DropdownComponent, ItemView, type WorkspaceLeaf } from "obsidian";
import { QUESTION_KIND_NAMES, type QuestionDefinition } from "../core/definition";
import { hasAnyTag, normaliseTags } from "../core/tags";
import type ExaminerPlugin from "../main";
import { renderLoadState, renderSectionNav, renderStudyTimerButton, renderTags, textButton, updateStudyTimerButton } from "./shared";

export const VIEW_TYPE_QUESTIONS = "examiner-questions";

const ALL_TAGS = "";

export class QuestionsView extends ItemView {
	private timerButton: HTMLButtonElement | null = null;
	private listEl: HTMLElement | null = null;
	private tagFilter = ALL_TAGS;
	private search = "";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_QUESTIONS;
	}

	override getDisplayText(): string {
		return "Questions";
	}

	override getIcon(): string {
		return "list";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-questions");
		this.register(this.plugin.questions.onChange(() => this.render()));
		this.register(this.plugin.loadState.onChange(() => this.render()));
		this.register(this.plugin.results.onChange(() => this.updateTimerButton()));
		this.registerInterval(window.setInterval(() => this.updateTimerButton(), 1000));
		this.render();
		await Promise.resolve();
	}

	private render(): void {
		const root = createDiv({ cls: "examiner-exams-body" });
		const header = root.createDiv({ cls: "examiner-page-header" });
		renderSectionNav(header, this.plugin, this.leaf, "questions");
		const actions = header.createDiv({ cls: "examiner-header-actions" });
		this.timerButton = renderStudyTimerButton(actions, this.plugin);
		textButton(actions, "New question", true).addEventListener("click", () => void this.plugin.createQuestion());
		this.listEl = null;

		if (!this.plugin.ready) {
			renderLoadState(root.createDiv({ cls: "examiner-empty" }), this.plugin);
			this.contentEl.replaceChildren(root);
			return;
		}

		const questions = this.plugin.questions.definitions();
		if (questions.length > 0) {
			this.renderFilters(root, questions);
			this.listEl = root.createDiv({ cls: "examiner-list" });
			this.renderList();
		}
		this.contentEl.replaceChildren(root);
	}

	private renderFilters(root: HTMLElement, questions: readonly QuestionDefinition[]): void {
		const tags = normaliseTags(questions.flatMap((question) => question.tags));
		if (!tags.includes(this.tagFilter)) this.tagFilter = ALL_TAGS;
		const filters = root.createDiv({ cls: "examiner-row-fields examiner-exam-filters" });
		const tagDropdown = new DropdownComponent(filters).addOption(ALL_TAGS, "All tags");
		for (const tag of tags) tagDropdown.addOption(tag, tag);
		tagDropdown.setValue(this.tagFilter).onChange((value) => {
			this.tagFilter = value;
			this.renderList();
		});
		const search = filters.createEl("input", { type: "search", attr: { placeholder: "Search titles", "aria-label": "Search titles" } });
		search.value = this.search;
		search.addEventListener("input", () => {
			this.search = search.value.trim().toLowerCase();
			this.renderList();
		});
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		const matches = this.plugin
			.questions.definitions()
			.filter((question) => this.tagFilter === ALL_TAGS || hasAnyTag(question.tags, [this.tagFilter]))
			.filter((question) => this.search === "" || question.title.toLowerCase().includes(this.search));
		for (const question of matches) this.renderQuestion(list, question);
	}

	private renderQuestion(parent: HTMLElement, question: QuestionDefinition): void {
		const usable = this.plugin.questionIsUsable(question);
		const row = parent.createDiv({ cls: "examiner-list-row" });
		const main = row.createDiv({ cls: "examiner-row-main" });
		main.createDiv({ cls: "examiner-row-title", text: question.title || "Untitled question" });
		const meta = [QUESTION_KIND_NAMES[question.kind], question.marks === 1 ? "1 mark" : `${question.marks} marks`];
		main.createDiv({ cls: "examiner-row-meta", text: meta.join(", ") });
		renderTags(main, question.tags);
		if (!usable) row.createSpan({ cls: "examiner-status-label", text: "Has errors" });

		const actions = row.createDiv({ cls: "examiner-row-actions" });
		const practice = textButton(actions, "Practice", true);
		practice.disabled = !usable;
		practice.addEventListener("click", () => void this.plugin.openPractice(question.id));
		textButton(actions, "Edit").addEventListener("click", () => void this.plugin.openQuestionEditor(question.id));
	}

	private updateTimerButton(): void {
		if (this.timerButton) updateStudyTimerButton(this.timerButton, this.plugin);
	}
}
