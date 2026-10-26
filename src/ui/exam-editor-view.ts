import { DropdownComponent, ItemView, Notice, setIcon, Setting, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { hasErrors, QUESTION_KIND_NAMES, type ValidationIssue } from "../core/definition";
import {
	DEFAULT_PASSING_PERCENT,
	formatTimeLimit,
	isValidPassingPercent,
	TIME_LIMIT_PRESETS,
	validateExam,
	type ExamDefinition,
} from "../core/exam";
import { hasAnyTag, normaliseTags } from "../core/tags";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { confirm, iconAction, renderLoadState, renderTags, textButton } from "./shared";
import { AttachmentError, attachmentKind } from "../storage/attachments";
import { startExam } from "./start-exam";


export const VIEW_TYPE_EXAM_EDITOR = "examiner-exam-editor";

export interface ExamEditorState {
	examId?: string;
	draft?: boolean;
}

const ALL_TAGS = "";

function blankExam(): ExamDefinition {
	return { id: createId("e"), title: "", tags: [], timeLimitMinutes: null, passingPercent: DEFAULT_PASSING_PERCENT, questions: [] };
}

export class ExamEditorView extends ItemView {
	private exam: ExamDefinition = blankExam();
	private baseline = JSON.stringify(this.exam);
	private isNew = true;
	private requestedId: string | null = null;
	private saving = false;
	private tagFilter = ALL_TAGS;
	private search = "";
	private listEl: HTMLElement | null = null;
	private availableEl: HTMLElement | null = null;
	private titleIssuesEl: HTMLElement | null = null;
	private passingIssuesEl: HTMLElement | null = null;
	private questionIssuesEl: HTMLElement | null = null;
	private attachmentsEl: HTMLElement | null = null;
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
		return VIEW_TYPE_EXAM_EDITOR;
	}

	override getDisplayText(): string {
		return "Exam editor";
	}

	override getIcon(): string {
		return "list-checks";
	}

	override getState(): Record<string, unknown> {
		const state: ExamEditorState = this.isNew ? {} : { examId: this.exam.id };
		return { ...state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const { examId = null, draft = false } = (state as ExamEditorState | null) ?? {};
		const pendingDraft = draft ? this.plugin.pendingExamDraft : null;
		if (pendingDraft && this.plugin.ready) {
			this.plugin.pendingExamDraft = null;
			if (await this.confirmDiscard()) {
				await this.discardUploads();
				this.loadDraft(pendingDraft);
			}
		} else if (!this.plugin.ready) {
			this.requestedId = examId;
		} else if (examId !== (this.isNew ? null : this.exam.id) || (examId === null && !this.isDirty())) {
			await this.openExam(examId);
		}
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-exam-editor");
		this.register(this.plugin.loadState.onChange(() => this.handleLoadStateChange()));
		this.register(this.plugin.questions.onChange(() => this.handleLibraryChange()));
		this.register(this.plugin.exams.onChange(() => this.handleExamsChange()));
		this.render();
		await Promise.resolve();
	}

	override async onClose(): Promise<void> {
		if (this.isDirty()) await this.discardUploads();
	}

	private handleLoadStateChange(): void {
		if (this.plugin.ready && this.requestedId !== null) {
			const id = this.requestedId;
			this.requestedId = null;
			this.loadExam(id);
		}
		this.render();
	}

	private handleExamsChange(): void {
		if (!this.plugin.ready || this.saving || !this.toolbarEl) return;
		if (!this.isNew && !this.plugin.exams.get(this.exam.id)) {
			this.loadExam(null);
			this.render();
			return;
		}
		this.renderToolbar();

	}

	private handleLibraryChange(): void {
		if (!this.plugin.ready || this.saving || !this.listEl) return;
		this.renderQuestions();
	}

	private isDirty(): boolean {
		return JSON.stringify(this.exam) !== this.baseline;
	}

	private async openExam(examId: string | null): Promise<void> {
		if (!(await this.confirmDiscard())) {
			this.renderToolbar();
			return;
		}
		await this.discardUploads();
		this.loadExam(examId);
		this.render();
	}

	private loadDraft(draft: ExamDefinition): void {
		this.isNew = true;
		this.exam = structuredClone(draft);
		this.baseline = JSON.stringify({ ...blankExam(), id: draft.id });
		this.tagFilter = ALL_TAGS;
		this.search = "";
		this.render();
	}

	private loadExam(examId: string | null): void {
		const existing = examId === null ? undefined : this.plugin.exams.get(examId);
		if (examId !== null && !existing) new Notice("That exam could not be found.");
		this.isNew = !existing;
		this.exam = existing ? structuredClone(existing) : blankExam();
		this.baseline = JSON.stringify(this.exam);
		this.tagFilter = ALL_TAGS;
		this.search = "";
		this.app.workspace.requestSaveLayout();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		this.toolbarEl = null;
		this.listEl = null;
		this.availableEl = null;
		if (!this.plugin.ready) {
			renderLoadState(root.createDiv({ cls: "examiner-empty" }), this.plugin);
			return;
		}

		this.toolbarEl = root.createDiv({ cls: "examiner-toolbar examiner-exam-editor-toolbar" });
		this.renderToolbar();

		const columns = root.createDiv({ cls: "examiner-exam-editor-columns" });
		const details = columns.createDiv({ cls: "examiner-exam-editor-panel" });
		const source = columns.createDiv({ cls: "examiner-exam-editor-panel" });

		const titleSetting = new Setting(details).setName("Title");
		titleSetting.settingEl.addClass("examiner-title-setting");
		this.titleIssuesEl = titleSetting.controlEl.createDiv({ cls: "examiner-field-issues" });
		titleSetting.addText((text) =>
			text
				.setPlaceholder("My new exam")
				.setValue(this.exam.title)
				.onChange((value) => {
					this.exam.title = value;
					this.renderIssues();
				}),
		);

		new Setting(details)
			.setName("Time limit")
			.setDesc("When time runs out, the exam is submitted with the answers given so far.")
			.addDropdown((dropdown) => {
				dropdown.addOption("none", "No time limit");
				const options = new Set<number>(TIME_LIMIT_PRESETS);
				if (this.exam.timeLimitMinutes !== null) options.add(this.exam.timeLimitMinutes);
				for (const minutes of [...options].sort((a, b) => a - b)) dropdown.addOption(String(minutes), formatTimeLimit(minutes));
				dropdown.setValue(this.exam.timeLimitMinutes === null ? "none" : String(this.exam.timeLimitMinutes));
				dropdown.onChange((value) => {
					this.exam.timeLimitMinutes = value === "none" ? null : Number(value);
					this.updateActions();
				});
			});

		new Setting(details).setName("Passing grade").addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "0";
			text.inputEl.max = "100";
			text.inputEl.step = "1";
			text.inputEl.addClass("examiner-count-input");
			text.inputEl.setAttribute("aria-label", "Passing grade, percent");
			text.setValue(String(this.exam.passingPercent)).onChange((value) => {
				this.exam.passingPercent = value.trim() === "" ? Number.NaN : Number(value);
				text.inputEl.toggleClass("examiner-invalid", !isValidPassingPercent(this.exam.passingPercent));
				this.renderIssues();
			});
			text.inputEl.insertAdjacentElement("afterend", createSpan({ cls: "examiner-muted", text: "%" }));
		});
		this.passingIssuesEl = details.createDiv({ cls: "examiner-field-issues" });

		new Setting(details).setName("Randomize question order").addToggle((toggle) =>
			toggle.setValue(this.exam.shuffle === true).onChange((value) => {
				if (value) this.exam.shuffle = true;
				else delete this.exam.shuffle;
				this.updateActions();
			}),
		);

		details.createDiv({ cls: "examiner-section-title", text: "Reference materials" });
		this.attachmentsEl = details.createDiv({ cls: "examiner-attachments" });
		this.renderAttachments();

		details.createDiv({ cls: "examiner-section-title", text: "Questions" });
		this.questionIssuesEl = details.createDiv({ cls: "examiner-field-issues" });
		this.listEl = details.createDiv({ cls: "examiner-exam-questions" });

		source.createDiv({ cls: "examiner-section-title examiner-exam-editor-source-inline", text: "Add questions" });
		const filters = source.createDiv({ cls: "examiner-row-fields examiner-exam-filters" });
		const tagDropdown = new DropdownComponent(filters).addOption(ALL_TAGS, "All tags");
		for (const tag of normaliseTags(this.plugin.questions.definitions().flatMap((question) => question.tags))) {
			tagDropdown.addOption(tag, tag);
		}
		tagDropdown.setValue(this.tagFilter).onChange((value) => {
			this.tagFilter = value;
			this.renderAvailable(false);
		});
		const search = filters.createEl("input", { type: "search", attr: { placeholder: "Search titles", "aria-label": "Search titles" } });
		search.value = this.search;
		search.addEventListener("input", () => {
			this.search = search.value.trim().toLowerCase();
			this.renderAvailable(false);
		});
		this.availableEl = source.createDiv({ cls: "examiner-exam-available" });

		this.renderQuestions();
	}

	private renderToolbar(): void {
		const toolbar = this.toolbarEl;
		if (!toolbar) return;
		toolbar.empty();
		toolbar.createEl("h2", { cls: "examiner-heading", text: this.getDisplayText() });

		const dropdown = new DropdownComponent(toolbar);
		dropdown.selectEl.addClass("examiner-question-select");
		dropdown.selectEl.setAttribute("aria-label", "Exam");
		if (this.isNew) dropdown.addOption("", "New exam (not saved)");
		for (const exam of this.plugin.exams.definitions()) dropdown.addOption(exam.id, exam.title || "Untitled exam");
		dropdown.setValue(this.isNew ? "" : this.exam.id);
		dropdown.onChange((id) => void this.openExam(id === "" ? null : id));
		iconAction(toolbar, "plus", "New exam").addEventListener("click", () => void this.openExam(null));

		toolbar.createDiv({ cls: "examiner-spacer" });
		textButton(toolbar, "Practice").addEventListener("click", () => void this.practice());
		this.discardButton = textButton(toolbar, "Discard changes");
		this.discardButton.addEventListener("click", () => void this.discard());
		this.saveButton = textButton(toolbar, "Save exam", true);

		this.saveButton.addEventListener("click", () => void this.save());
		this.updateActions();
	}

	private async practice(): Promise<void> {
		if (this.isNew) {
			new Notice("Save the exam before practicing it.");
			return;
		}
		if (this.isDirty()) {
			new Notice("Save your changes before practicing this exam.");
			return;
		}
		const exam = this.plugin.exams.get(this.exam.id);
		if (!exam) {
			new Notice("That exam could not be found.");
			return;
		}
		await startExam(this.plugin, exam);
	}

	private addQuestions(ids: readonly string[]): void {
		for (const questionId of ids) this.exam.questions.push({ questionId, count: 1 });
		this.renderQuestions();
	}

	private renderQuestions(): void {
		const listEl = this.listEl;
		if (!listEl) return;
		const scrollTop = listEl.querySelector(".examiner-table-scroll")?.scrollTop ?? 0;
		listEl.empty();
		if (this.exam.questions.length > 0) this.renderQuestionTable(listEl).scrollTop = scrollTop;
		this.renderAvailable(true);
		this.renderIssues();
	}

	private renderQuestionTable(listEl: HTMLElement): HTMLElement {
		const scroller = listEl.createDiv({ cls: "examiner-table-scroll" });
		const table = scroller.createEl("table", { cls: "examiner-question-table" });
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", { text: "Question" });
		head.createEl("th", { cls: "examiner-col-type", text: "Type" });
		head.createEl("th", { cls: "examiner-col-count", text: "Amount" });
		head.createEl("th", { cls: "examiner-col-action", attr: { "aria-label": "Remove" } });

		const body = table.createEl("tbody");
		this.exam.questions.forEach((ref, index) => {
			const question = this.plugin.questions.get(ref.questionId);
			const row = body.createEl("tr");

			const info = row.createEl("td");
			if (question) {
				info.createDiv({ cls: "examiner-question-table-title", text: question.title || "Untitled question" });
				renderTags(info, question.tags);
				if (!this.plugin.questionIsUsable(question)) {
					info.createDiv({ cls: "examiner-warning-text", text: "This question has errors and will be skipped." });
				}
			} else {
				info.createDiv({ cls: "examiner-warning-text", text: `Missing question (${ref.questionId}). It will be skipped.` });
			}

			row.createEl("td", { cls: "examiner-col-type", text: question ? QUESTION_KIND_NAMES[question.kind] : "" });

			const count = row.createEl("td", { cls: "examiner-col-count" }).createEl("input", {
				type: "number",
				cls: "examiner-count-input",
				value: String(ref.count),
				attr: { "aria-label": `Amount of ${question?.title || "this question"}`, min: "1", step: "1" },
			});
			count.addEventListener("input", () => {
				ref.count = Number(count.value);
				this.renderIssues();
			});

			const remove = row.createEl("td", { cls: "examiner-col-action" }).createEl("button", {
				cls: "clickable-icon",
				attr: { "aria-label": "Remove from exam" },
			});
			setIcon(remove, "x");
			remove.addEventListener("click", () => {
				this.exam.questions.splice(index, 1);
				this.renderQuestions();
			});
		});
		return scroller;
	}

	private renderAvailable(keepScroll: boolean): void {
		const availableEl = this.availableEl;
		if (!availableEl) return;
		const scrollTop = keepScroll ? availableEl.scrollTop : 0;
		availableEl.empty();
		const included = new Set(this.exam.questions.map((ref) => ref.questionId));
		const matches = this.plugin
			.usableQuestions()
			.filter((question) => !included.has(question.id))
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

	private renderIssues(): void {
		const issues = validateExam(this.exam);
		const show = (el: HTMLElement | null, matches: (issue: ValidationIssue) => boolean) => {
			if (!el) return;
			el.empty();
			for (const issue of issues.filter(matches)) el.createDiv({ cls: "examiner-error-text", text: issue.message });
		};
		show(this.titleIssuesEl, (issue) => issue.path === "title");
		show(this.passingIssuesEl, (issue) => issue.path === "passingPercent");
		show(this.questionIssuesEl, (issue) => issue.path.startsWith("questions"));
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

	private renderAttachments(): void {
		const el = this.attachmentsEl;
		if (!el) return;
		el.empty();
		const names = this.exam.attachments ?? [];
		if (names.length > 0) {
			const list = el.createDiv({ cls: "examiner-attachment-list" });
			for (const name of names) {
				const row = list.createDiv({ cls: "examiner-attachment-row" });
				setIcon(row.createSpan({ cls: "examiner-attachment-icon" }), attachmentKind(name) === "pdf" ? "file-text" : "image");
				row.createSpan({ cls: "examiner-attachment-name", text: name, attr: { title: name } });
				const remove = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Remove ${name}` } });
				setIcon(remove, "x");
				remove.addEventListener("click", () => {
					const remaining = (this.exam.attachments ?? []).filter((entry) => entry !== name);
					if (remaining.length > 0) this.exam.attachments = remaining;
					else delete this.exam.attachments;
					this.renderAttachments();
					this.updateActions();
				});
			}
		}

		const zone = el.createDiv({ cls: "examiner-dropzone" });
		zone.createSpan({ cls: "examiner-muted examiner-small", text: "Drop PDFs or images here" });
		const input = zone.createEl("input", { type: "file", cls: "examiner-file-input", attr: { accept: ".pdf,image/*", multiple: "" } });
		textButton(zone, "Browse").addEventListener("click", () => input.click());
		input.addEventListener("change", () => {
			const files = Array.from(input.files ?? []);
			input.value = "";
			void this.upload(files);
		});
		zone.addEventListener("dragover", (event) => {
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			zone.addClass("is-dragging");
		});
		zone.addEventListener("dragleave", (event) => {
			if (!zone.contains(event.relatedTarget as Node | null)) zone.removeClass("is-dragging");
		});
		zone.addEventListener("drop", (event) => {
			event.preventDefault();
			zone.removeClass("is-dragging");
			void this.upload(Array.from(event.dataTransfer?.files ?? []));
		});
	}

	private async upload(files: readonly File[]): Promise<void> {
		const exam = this.exam;
		for (const file of files) {
			if (attachmentKind(file.name) === null) {
				new Notice(`${file.name} is not a PDF or an image, so it was not attached.`);
				continue;
			}
			try {
				const name = await this.plugin.attachments.add(exam.id, file.name, await file.arrayBuffer(), exam.attachments ?? []);
				exam.attachments = [...(exam.attachments ?? []), name];
			} catch (error) {
				console.error("Examiner: could not attach a file", error);
				new Notice(error instanceof AttachmentError ? error.message : `Could not attach ${file.name}.`);
			}
		}
		if (exam !== this.exam) return;
		this.renderAttachments();
		this.updateActions();
	}

	private async discardUploads(): Promise<void> {
		const saved = this.plugin.exams.get(this.exam.id);
		await this.plugin.attachments.prune(this.exam.id, saved?.attachments ?? []).catch((error: unknown) => {
			console.error("Examiner: could not tidy up unsaved reference materials", error);
		});
	}

	private async discard(): Promise<void> {
		if (!(await this.confirmDiscard())) return;
		await this.discardUploads();
		this.loadExam(this.isNew ? null : this.exam.id);
		this.render();
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		const exam: ExamDefinition = { ...structuredClone(this.exam), title: this.exam.title.trim() };
		if (hasErrors(validateExam(exam))) {
			this.renderIssues();
			return;
		}
		this.saving = true;
		try {
			if (this.plugin.exams.pathOf(exam.id) !== undefined) await this.plugin.exams.save(exam);
			else await this.plugin.exams.create(exam);
		} catch (error) {
			new Notice(`Could not save the exam: ${error instanceof Error ? error.message : String(error)}`);
			return;
		} finally {
			this.saving = false;
		}
		await this.plugin.attachments.prune(exam.id, exam.attachments ?? []).catch((error: unknown) => {
			console.error("Examiner: could not tidy up removed reference materials", error);
		});
		new Notice(`Saved "${exam.title}".`);
		this.exam = exam;
		this.baseline = JSON.stringify(exam);
		this.isNew = false;
		this.render();
		this.app.workspace.requestSaveLayout();
	}
}
