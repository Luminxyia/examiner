import { DropdownComponent, ItemView, Notice, setIcon, Setting, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { hasErrors, QUESTION_KIND_NAMES, type ValidationIssue } from "../core/definition";
import { DEFAULT_TARGET_PERCENT, validateUpcomingExam, type UpcomingExam } from "../core/exam-prep";
import { hasAnyTag, normaliseTags } from "../core/tags";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { confirm, iconAction, renderLoadState, renderTags, textButton } from "./shared";

export const VIEW_TYPE_UPCOMING_EXAM_EDITOR = "examiner-upcoming-exam-editor";

export interface UpcomingExamEditorState {
	upcomingId?: string;
}

const ALL_TAGS = "";

const ACCURACY_NOTE = "Add content that you know or believe will be on the exam";

function blankUpcomingExam(): UpcomingExam {
	return { id: createId("u"), title: "", date: "", targetPercent: DEFAULT_TARGET_PERCENT, questionIds: [], examIds: [] };
}

export class UpcomingExamEditorView extends ItemView {
	private exam: UpcomingExam = blankUpcomingExam();
	private baseline = JSON.stringify(this.exam);
	private stored: UpcomingExam[] = [];
	private isNew = true;
	private requestedId: string | null = null;
	private saving = false;
	private tagFilter = ALL_TAGS;
	private search = "";
	private questionsEl: HTMLElement | null = null;
	private examsEl: HTMLElement | null = null;
	private availableQuestionsEl: HTMLElement | null = null;
	private availableExamsEl: HTMLElement | null = null;
	private titleIssuesEl: HTMLElement | null = null;
	private dateIssuesEl: HTMLElement | null = null;
	private targetIssuesEl: HTMLElement | null = null;
	private scopeIssuesEl: HTMLElement | null = null;
	private toolbarEl: HTMLElement | null = null;
	private discardButton: HTMLButtonElement | null = null;
	private saveButton: HTMLButtonElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_UPCOMING_EXAM_EDITOR;
	}

	override getDisplayText(): string {
		return "Upcoming exam editor";
	}

	override getIcon(): string {
		return "calendar-clock";
	}

	override getState(): Record<string, unknown> {
		const state: UpcomingExamEditorState = this.isNew ? {} : { upcomingId: this.exam.id };
		return { ...state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const upcomingId = (state as UpcomingExamEditorState | null)?.upcomingId ?? null;
		const currentId = this.isNew ? null : this.exam.id;
		if (!this.plugin.ready) {
			this.requestedId = upcomingId;
		} else if (upcomingId !== currentId || (upcomingId === null && !this.isDirty())) {
			await this.openUpcoming(upcomingId);
		}
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-exam-editor");
		this.register(this.plugin.loadState.onChange(() => void this.handleLoadStateChange()));
		this.register(this.plugin.questions.onChange(() => this.handleLibraryChange()));
		this.register(this.plugin.exams.onChange(() => this.handleLibraryChange()));
		await this.refreshStored();
		this.render();
	}

	private async handleLoadStateChange(): Promise<void> {
		if (this.plugin.ready) {
			await this.refreshStored();
			if (this.requestedId !== null) {
				const id = this.requestedId;
				this.requestedId = null;
				this.loadUpcoming(id);
			}
		}
		this.render();
	}

	private handleLibraryChange(): void {
		if (!this.plugin.ready || this.saving || !this.questionsEl) return;
		this.renderLists();
	}

	private isDirty(): boolean {
		return JSON.stringify(this.exam) !== this.baseline;
	}

	private async refreshStored(): Promise<void> {
		try {
			const exams = await this.plugin.results.readUpcomingExams();
			this.stored = exams.sort((a, b) => a.date.localeCompare(b.date));
		} catch (error) {
			console.error("Examiner: could not read upcoming exams", error);
			new Notice("Upcoming exams could not be read. See the developer console for details.");
			this.stored = [];
		}
	}

	private async openUpcoming(upcomingId: string | null): Promise<void> {
		if (!(await this.confirmDiscard())) {
			this.renderToolbar();
			return;
		}
		await this.refreshStored();
		this.loadUpcoming(upcomingId);
		this.render();
	}

	private loadUpcoming(upcomingId: string | null): void {
		const existing = upcomingId === null ? undefined : this.stored.find((exam) => exam.id === upcomingId);
		if (upcomingId !== null && !existing) new Notice("That upcoming exam could not be found.");
		this.isNew = !existing;
		this.exam = existing ? this.withoutDeletedReferences(existing) : blankUpcomingExam();
		this.baseline = JSON.stringify(this.exam);
		this.tagFilter = ALL_TAGS;
		this.search = "";
		this.app.workspace.requestSaveLayout();
	}

	private withoutDeletedReferences(exam: UpcomingExam): UpcomingExam {
		return {
			...exam,
			questionIds: exam.questionIds.filter((id) => this.plugin.questions.get(id) !== undefined),
			examIds: exam.examIds.filter((id) => this.plugin.exams.get(id) !== undefined),
		};
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		this.toolbarEl = null;
		this.questionsEl = null;
		this.examsEl = null;
		this.availableQuestionsEl = null;
		this.availableExamsEl = null;
		if (!this.plugin.ready) {
			renderLoadState(root.createDiv({ cls: "examiner-empty" }), this.plugin);
			return;
		}

		this.toolbarEl = root.createDiv({ cls: "examiner-toolbar examiner-exam-editor-toolbar" });
		this.renderToolbar();

		const columns = root.createDiv({ cls: "examiner-exam-editor-columns" });
		const details = columns.createDiv({ cls: "examiner-exam-editor-panel" });
		const source = columns.createDiv({ cls: "examiner-exam-editor-panel" });

		this.renderDetails(details);
		this.renderSource(source);
		this.renderLists();
	}

	private renderDetails(details: HTMLElement): void {
		const titleSetting = new Setting(details).setName("Title");
		titleSetting.settingEl.addClass("examiner-title-setting");
		this.titleIssuesEl = titleSetting.controlEl.createDiv({ cls: "examiner-field-issues" });
		titleSetting.addText((text) => {
			text.setValue(this.exam.title);
			text.onChange((value) => {
				this.exam.title = value;
				this.renderIssues();
			});
		});

		new Setting(details).setName("Date").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.exam.date);
			text.onChange((value) => {
				this.exam.date = value;
				this.renderIssues();
			});
		});
		this.dateIssuesEl = details.createDiv({ cls: "examiner-field-issues" });

		new Setting(details).setName("Target grade").addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "1";
			text.inputEl.max = "100";
			text.inputEl.step = "1";
			text.inputEl.addClass("examiner-count-input");
			text.inputEl.setAttribute("aria-label", "Target grade, percent");
			text.setValue(String(this.exam.targetPercent));
			text.onChange((value) => {
				if (value.trim() === "") this.exam.targetPercent = Number.NaN;
				else this.exam.targetPercent = Number(value);
				this.renderIssues();
			});
			text.inputEl.insertAdjacentElement("afterend", createSpan({ cls: "examiner-muted", text: "%" }));
		});
		this.targetIssuesEl = details.createDiv({ cls: "examiner-field-issues" });

		details.createDiv({ cls: "examiner-section-title", text: "Questions" });
		details.createDiv({ cls: "examiner-muted examiner-small", text: ACCURACY_NOTE });
		this.scopeIssuesEl = details.createDiv({ cls: "examiner-field-issues" });
		this.questionsEl = details.createDiv({ cls: "examiner-exam-questions" });

		details.createDiv({ cls: "examiner-section-title", text: "Exams" });
		this.examsEl = details.createDiv({ cls: "examiner-exam-questions" });
	}

	private renderSource(source: HTMLElement): void {
		source.createDiv({ cls: "examiner-section-title examiner-exam-editor-source-inline", text: "Add questions" });
		const filters = source.createDiv({ cls: "examiner-row-fields examiner-exam-filters" });
		const tagDropdown = new DropdownComponent(filters).addOption(ALL_TAGS, "All tags");
		for (const tag of normaliseTags(this.plugin.questions.definitions().flatMap((question) => question.tags))) {
			tagDropdown.addOption(tag, tag);
		}
		tagDropdown.setValue(this.tagFilter).onChange((value) => {
			this.tagFilter = value;
			this.renderAvailableQuestions(false);
		});
		const search = filters.createEl("input", { type: "search", attr: { placeholder: "Search titles", "aria-label": "Search titles" } });
		search.value = this.search;
		search.addEventListener("input", () => {
			this.search = search.value.trim().toLowerCase();
			this.renderAvailableQuestions(false);
		});
		this.availableQuestionsEl = source.createDiv({ cls: "examiner-exam-available examiner-upcoming-available" });

		source.createDiv({ cls: "examiner-section-title", text: "Add exams" });
		this.availableExamsEl = source.createDiv({ cls: "examiner-exam-available examiner-upcoming-available" });
	}

	private renderToolbar(): void {
		const toolbar = this.toolbarEl;
		if (!toolbar) return;
		toolbar.empty();
		toolbar.createEl("h2", { cls: "examiner-heading", text: this.getDisplayText() });

		const dropdown = new DropdownComponent(toolbar);
		dropdown.selectEl.addClass("examiner-question-select");
		dropdown.selectEl.setAttribute("aria-label", "Upcoming exam");
		if (this.isNew) dropdown.addOption("", "New upcoming exam (not saved)");
		for (const exam of this.stored) dropdown.addOption(exam.id, exam.title);
		dropdown.setValue(this.isNew ? "" : this.exam.id);
		dropdown.onChange((id) => void this.openUpcoming(id === "" ? null : id));
		iconAction(toolbar, "plus", "New upcoming exam").addEventListener("click", () => void this.openUpcoming(null));

		toolbar.createDiv({ cls: "examiner-spacer" });
		if (!this.isNew) {
			const remove = textButton(toolbar, "Delete");
			remove.addClass("mod-warning");
			remove.addEventListener("click", () => void this.delete());
		}
		this.discardButton = textButton(toolbar, "Discard changes");
		this.discardButton.addEventListener("click", () => void this.discard());
		this.saveButton = textButton(toolbar, "Save exam", true);
		this.saveButton.addEventListener("click", () => void this.save());
		this.updateActions();
	}

	private renderLists(): void {
		this.renderQuestionTable();
		this.renderExamTable();
		this.renderAvailableQuestions(true);
		this.renderAvailableExams();
		this.renderIssues();
	}

	private renderQuestionTable(): void {
		const parent = this.questionsEl;
		if (!parent) return;
		parent.empty();
		if (this.exam.questionIds.length === 0) return;
		const body = this.createTable(parent, "Question", "Type", "examiner-col-type");

		for (const questionId of this.exam.questionIds) {
			const question = this.plugin.questions.get(questionId);
			if (!question) continue;
			const row = body.createEl("tr");
			const info = row.createEl("td");
			info.createDiv({ cls: "examiner-question-table-title", text: question.title || "Untitled question" });
			renderTags(info, question.tags);
			if (!this.plugin.questionIsUsable(question)) {
				info.createDiv({ cls: "examiner-warning-text", text: "This question has errors and will be skipped." });
			}
			row.createEl("td", { cls: "examiner-col-type", text: QUESTION_KIND_NAMES[question.kind] });
			this.renderRemoveCell(row, () => {
				this.exam.questionIds = this.exam.questionIds.filter((id) => id !== questionId);
				this.renderLists();
			});
		}
	}

	private renderExamTable(): void {
		const parent = this.examsEl;
		if (!parent) return;
		parent.empty();
		if (this.exam.examIds.length === 0) return;
		const body = this.createTable(parent, "Exam", "Questions", "examiner-col-count");

		for (const examId of this.exam.examIds) {
			const exam = this.plugin.exams.get(examId);
			if (!exam) continue;
			const row = body.createEl("tr");
			const info = row.createEl("td");
			info.createDiv({ cls: "examiner-question-table-title", text: exam.title || "Untitled exam" });
			renderTags(info, exam.tags);
			row.createEl("td", { cls: "examiner-col-count", text: String(exam.questions.length) });
			this.renderRemoveCell(row, () => {
				this.exam.examIds = this.exam.examIds.filter((id) => id !== examId);
				this.renderLists();
			});
		}
	}

	private createTable(parent: HTMLElement, firstHeading: string, secondHeading: string, secondClass: string): HTMLElement {
		const scroller = parent.createDiv({ cls: "examiner-table-scroll" });
		const table = scroller.createEl("table", { cls: "examiner-question-table" });
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", { text: firstHeading });
		head.createEl("th", { cls: secondClass, text: secondHeading });
		head.createEl("th", { cls: "examiner-col-action", attr: { "aria-label": "Remove" } });
		return table.createEl("tbody");
	}

	private renderRemoveCell(row: HTMLElement, onRemove: () => void): void {
		const remove = row.createEl("td", { cls: "examiner-col-action" }).createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Remove" },
		});
		setIcon(remove, "x");
		remove.addEventListener("click", onRemove);
	}

	private addQuestions(ids: readonly string[]): void {
		for (const questionId of ids) this.exam.questionIds.push(questionId);
		this.renderLists();
	}

	private renderAvailableQuestions(keepScroll: boolean): void {
		const availableEl = this.availableQuestionsEl;
		if (!availableEl) return;
		const scrollTop = keepScroll ? availableEl.scrollTop : 0;
		availableEl.empty();
		const matches = this.plugin
			.usableQuestions()
			.filter((question) => !this.exam.questionIds.includes(question.id))
			.filter((question) => this.tagFilter === ALL_TAGS || hasAnyTag(question.tags, [this.tagFilter]))
			.filter((question) => this.search === "" || question.title.toLowerCase().includes(this.search));

		if (matches.length === 0) {
			availableEl.createDiv({ cls: "examiner-muted examiner-exam-available-empty", text: "No other questions match." });
			return;
		}
		if (matches.length > 1) {
			const addAll = availableEl.createEl("button", { text: `Add all ${matches.length}` });
			addAll.addEventListener("click", () => this.addQuestions(matches.map((question) => question.id)));
		}
		for (const question of matches) {
			const row = availableEl.createDiv({ cls: "examiner-row" });
			const info = row.createDiv({ cls: "examiner-row-main" });
			info.createDiv({ text: question.title || "Untitled question" });
			renderTags(info, question.tags);
			const add = row.createEl("button", { text: "Add" });
			add.addEventListener("click", () => this.addQuestions([question.id]));
		}
		availableEl.scrollTop = scrollTop;
	}

	private renderAvailableExams(): void {
		const availableEl = this.availableExamsEl;
		if (!availableEl) return;
		const scrollTop = availableEl.scrollTop;
		availableEl.empty();
		const matches = this.plugin.exams.definitions().filter((exam) => !this.exam.examIds.includes(exam.id));

		if (matches.length === 0) {
			availableEl.createDiv({ cls: "examiner-muted examiner-exam-available-empty", text: "No other exams." });
			return;
		}
		for (const exam of matches) {
			const row = availableEl.createDiv({ cls: "examiner-row" });
			const info = row.createDiv({ cls: "examiner-row-main" });
			info.createDiv({ text: exam.title || "Untitled exam" });
			renderTags(info, exam.tags);
			const add = row.createEl("button", { text: "Add" });
			add.addEventListener("click", () => {
				this.exam.examIds.push(exam.id);
				this.renderLists();
			});
		}
		availableEl.scrollTop = scrollTop;
	}

	private renderIssues(): void {
		const issues = validateUpcomingExam(this.exam, new Date());
		const show = (el: HTMLElement | null, path: string) => {
			if (!el) return;
			el.empty();
			const matching = issues.filter((issue: ValidationIssue) => issue.path === path);
			for (const issue of matching) el.createDiv({ cls: "examiner-error-text", text: issue.message });
		};
		show(this.titleIssuesEl, "title");
		show(this.dateIssuesEl, "date");
		show(this.targetIssuesEl, "targetPercent");
		show(this.scopeIssuesEl, "questions");
		this.updateActions();
	}

	private updateActions(): void {
		const dirty = this.isDirty();
		if (this.discardButton) this.discardButton.disabled = !dirty;
		if (this.saveButton) this.saveButton.disabled = !this.isNew && !dirty;
	}

	private confirmDiscard(): Promise<boolean> {
		if (!this.isDirty()) return Promise.resolve(true);
		return confirm(this.app, {
			title: "Discard unsaved changes?",
			message: `Your changes to "${this.exam.title || "Untitled exam"}" have not been saved.`,
			confirmText: "Discard changes",
			destructive: true,
		});
	}

	private async discard(): Promise<void> {
		if (!(await this.confirmDiscard())) return;
		this.loadUpcoming(this.isNew ? null : this.exam.id);
		this.render();
	}

	private async delete(): Promise<void> {
		const confirmed = await confirm(this.app, {
			title: "Delete upcoming exam?",
			message: `"${this.exam.title}" will be removed. Your results are kept.`,
			confirmText: "Delete",
			destructive: true,
		});
		if (!confirmed) return;
		try {
			await this.plugin.results.deleteUpcomingExam(this.exam.id);
		} catch (error) {
			console.error("Examiner: could not delete the upcoming exam", error);
			new Notice("The upcoming exam could not be deleted. See the developer console for details.");
			return;
		}
		await this.refreshStored();
		this.loadUpcoming(null);
		this.render();
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		const exam: UpcomingExam = { ...structuredClone(this.exam), title: this.exam.title.trim() };
		if (hasErrors(validateUpcomingExam(exam, new Date()))) {
			this.renderIssues();
			return;
		}
		this.saving = true;
		try {
			await this.plugin.results.saveUpcomingExam(exam);
		} catch (error) {
			console.error("Examiner: could not save the upcoming exam", error);
			new Notice("The upcoming exam could not be saved. See the developer console for details.");
			return;
		} finally {
			this.saving = false;
		}
		new Notice(`Saved "${exam.title}".`);
		this.exam = exam;
		this.baseline = JSON.stringify(exam);
		this.isNew = false;
		await this.refreshStored();
		this.render();
		this.app.workspace.requestSaveLayout();
	}
}
