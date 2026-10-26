import type { EditorView } from "@codemirror/view";
import {
	debounce,
	DropdownComponent,
	ItemView,
	Notice,
	Scope,
	setIcon,
	setTooltip,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { answerInstruction, formatExpectedAnswer } from "../core/answer";
import {
	ANSWER_VARIABLE,
	blankFlashcard,
	DEFAULT_MARKS,
	hasErrors,
	questionSaveAction,
	validateDefinition,
	type AnswerRule,
	type FlashcardMode,
	type InputVariable,
	type QuestionDefinition,
	type QuestionKind,
	type ValidationIssue,
	type VariableKind,
	type VariableSource,
} from "../core/definition";
import { CONSTANTS, FUNCTIONS } from "../core/expression";
import { formatVariableValue, GenerationError, generateInstance, probeDefinition, workedSteps } from "../core/generate";
import { formatNumber, parseNumberInput } from "../core/numbers";
import { randomSeed, seededRandom } from "../core/random";
import { normaliseTags } from "../core/tags";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { withoutDefaultTags } from "../example";
import { serializeQuestion } from "../storage/question-format";
import { isVaultReference } from "../storage/attachments";
import { addAttachments, renderAttachmentPicker, renderQuestionImages } from "./attachment-picker";
import { createPromptEditor } from "./prompt-editor";
import { confirm, iconAction, renderLoadState, renderMarkdown, renderWorking, section, textButton } from "./shared";
import { renderTagEditor } from "./tag-editor";

export const VIEW_TYPE_QUESTION_EDITOR = "examiner-question-editor";

export interface QuestionEditorState {
	questionId?: string;
	newQuestion?: boolean;
}

export interface EditorDraft {
	draft: QuestionDefinition;
	isNew: boolean;
}

const VARIABLE_KIND_LABELS: Record<VariableKind, string> = {
	integer: "Random integer",
	decimal: "Random decimal",
	fixed: "Fixed value",
};

const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
	calculation: "Calculation question",
	flashcard: "Flashcard question",
};

const FLASHCARD_MODE_LABELS: Record<FlashcardMode, string> = {
	written: "Written answer",
	choice: "Multiple choice",
};

const ANSWER_CHECK_LABELS: Record<AnswerRule["check"], string> = {
	exact: "Exact value",
	rounded: "Rounded to decimal places",
	absolute: "Within a tolerance",
	relative: "Within a percentage",
};

function blankQuestion(): QuestionDefinition {
	return {
		id: createId("q"),
		kind: "calculation",
		title: "",
		prompt: "",
		variables: [],
		steps: [{ target: ANSWER_VARIABLE, expression: "" }],
		answer: { check: "exact" },
		flashcard: blankFlashcard(),
		marks: DEFAULT_MARKS,
		tags: [],
	};
}

function readNumberField(text: string): number {
	const parsed = parseNumberInput(text);
	return parsed.ok ? parsed.value : Number.NaN;
}

function showNumber(value: number): string {
	return Number.isFinite(value) ? String(value) : "";
}

function convertSource(source: VariableSource, kind: VariableKind): VariableSource {
	const min = source.kind === "fixed" ? source.value : source.min;
	const max = source.kind === "fixed" ? source.value : source.max;
	switch (kind) {
		case "integer":
			return { kind, min: Number.isFinite(min) ? Math.round(min) : 1, max: Number.isFinite(max) ? Math.round(max) : 10 };
		case "decimal":
			return { kind, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 10, places: 2 };
		case "fixed":
			return { kind, value: Number.isFinite(min) ? min : 0 };
	}
}

export class QuestionEditorView extends ItemView {
	private draft: QuestionDefinition = blankQuestion();
	private saved: QuestionDefinition | null = null;
	private saving = false;
	private previewSeed = randomSeed();
	private readonly collapsed = new Set<string>();
	private pendingQuestionId: string | null = null;
	private pendingNew = false;
	private dragging: { list: unknown[]; index: number } | null = null;
	private imagesEl: HTMLElement | null = null;

	private formRendered = false;
	private previewToken = 0;

	private toolbarEl!: HTMLElement;
	private problemsEl!: HTMLElement;
	private formEl!: HTMLElement;
	private issuesEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private saveButton!: HTMLButtonElement;
	private discardButton!: HTMLButtonElement;
	private issueSlots = new Map<string, HTMLElement>();
	private inputsByPath = new Map<string, HTMLElement>();
	private calculatedEl: HTMLElement | null = null;
	private promptEditor: EditorView | null = null;

	private readonly schedulePreview = debounce(() => void this.renderPreview(), 300, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "s", (event) => {
			event.preventDefault();
			void this.save();
			return false;
		});
	}

	override getViewType(): string {
		return VIEW_TYPE_QUESTION_EDITOR;
	}

	override getDisplayText(): string {
		return "Question editor";
	}

	override getIcon(): string {
		return "square-pen";
	}

	override getState(): Record<string, unknown> {
		const state: QuestionEditorState = this.saved ? { questionId: this.saved.id } : {};
		return { ...state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const { questionId, newQuestion } = (state as QuestionEditorState | null) ?? {};
		if (!this.plugin.ready) {
			this.pendingQuestionId = questionId ?? null;
			this.pendingNew = Boolean(newQuestion);
			await super.setState(state, result);
			return;
		}
		const pending = this.plugin.unsavedDraft;
		if (pending && (newQuestion ? pending.isNew : questionId === undefined || questionId === pending.draft.id)) {
			this.plugin.unsavedDraft = null;
			this.saved = this.plugin.questions.get(pending.draft.id) ?? null;
			this.draft = structuredClone(pending.draft);
			this.render();
			new Notice(`Restored unsaved changes to "${this.draft.title || "Untitled question"}".`);
		} else if (questionId !== undefined && questionId !== this.saved?.id) {
			await this.selectQuestion(questionId);
		} else if (newQuestion && this.saved !== null) {
			await this.selectQuestion(null);
		}

		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-editor");
		this.toolbarEl = this.contentEl.createDiv({ cls: "examiner-toolbar" });
		this.problemsEl = this.contentEl.createDiv();
		const body = this.contentEl.createDiv({ cls: "examiner-editor-body" });
		this.formEl = body.createDiv({ cls: "examiner-editor-form" });
		const side = body.createDiv({ cls: "examiner-editor-side" });
		this.issuesEl = side.createDiv();
		this.previewEl = side.createDiv();

		this.register(this.plugin.questions.onChange(() => this.handleLibraryChange()));
		this.register(this.plugin.loadState.onChange(() => this.handleLoadStateChange()));
		if (this.plugin.ready) this.loadInitialQuestion();
		this.render();
		await Promise.resolve();
	}

	override async onClose(): Promise<void> {
		this.promptEditor?.destroy();
		if (this.isDirty()) this.plugin.unsavedDraft = { draft: structuredClone(this.draft), isNew: this.saved === null };
		await Promise.resolve();
	}

	private loadInitialQuestion(): void {
		if (this.saved || this.isDirty()) return;
		const requested = this.pendingQuestionId === null ? undefined : this.plugin.questions.get(this.pendingQuestionId);
		this.pendingQuestionId = null;
		if (this.pendingNew) {
			this.pendingNew = false;
			return;
		}
		const question = requested ?? this.plugin.questions.definitions()[0];
		if (question) this.loadQuestion(question);
	}

	private isDirty(): boolean {
		if (this.saved === null) return serializeQuestion(this.draft) !== serializeQuestion({ ...blankQuestion(), id: this.draft.id });
		return serializeQuestion(this.draft) !== serializeQuestion(this.saved);
	}

	private loadQuestion(question: QuestionDefinition | null): void {
		this.saved = question ? structuredClone(question) : null;
		this.draft = question ? structuredClone(question) : blankQuestion();
		this.previewSeed = randomSeed();
	}

	private async confirmDiscard(): Promise<boolean> {
		if (!this.isDirty()) return true;
		return confirm(this.app, {
			title: "Discard unsaved changes?",
			message: `Your changes to "${this.draft.title || "Untitled question"}" have not been saved.`,
			confirmText: "Discard changes",
			destructive: true,
		});
	}

	private async selectQuestion(id: string | null): Promise<void> {
		if (!(await this.confirmDiscard())) {
			this.renderToolbar();
			return;
		}
		await this.discardUploads();
		this.loadQuestion(id === null ? null : (this.plugin.questions.get(id) ?? null));
		if (id !== null && !this.saved) new Notice("That question could not be found.");
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private handleLoadStateChange(): void {
		if (this.plugin.ready) this.loadInitialQuestion();
		this.render();
	}

	private handleLibraryChange(): void {
		if (this.saving || !this.plugin.ready) return;
		const stored = this.saved ? this.plugin.questions.get(this.saved.id) : undefined;
		if (this.saved && !stored) {
			this.loadQuestion(this.plugin.questions.definitions()[0] ?? null);
			this.render();
			return;
		}
		if (stored && this.saved && !this.isDirty() && serializeQuestion(stored) !== serializeQuestion(this.saved)) {
			this.loadQuestion(stored);
			this.render();
			return;
		}

		if (!this.formRendered) {
			this.loadInitialQuestion();
			this.render();
			return;
		}
		this.renderToolbar();
		this.renderProblems();
	}

	private render(): void {
		this.renderToolbar();
		this.renderProblems();
		this.renderForm();
		this.refreshDiagnostics();
	}

	private renderToolbar(): void {
		const toolbar = this.toolbarEl;
		toolbar.empty();
		if (!this.plugin.ready) {
			renderLoadState(toolbar, this.plugin);
			return;
		}

		const questions = this.plugin.questions.definitions();
		const titleCounts = new Map<string, number>();
		for (const question of questions) titleCounts.set(question.title, (titleCounts.get(question.title) ?? 0) + 1);

		const dropdown = new DropdownComponent(toolbar);
		dropdown.selectEl.addClass("examiner-question-select");
		dropdown.selectEl.setAttribute("aria-label", "Question");
		if (!this.saved) dropdown.addOption("", "New question (not saved)");
		for (const question of questions) {
			let label = question.title || "Untitled question";
			if ((titleCounts.get(question.title) ?? 0) > 1) {
				const path = this.plugin.questions.pathOf(question.id) ?? "";
				label += ` (${path.split("/").pop()?.replace(/\.md$/, "") ?? question.id})`;
			}
			dropdown.addOption(question.id, label);
		}
		dropdown.setValue(this.saved?.id ?? "");
		dropdown.onChange((id) => void this.selectQuestion(id === "" ? null : id));

		iconAction(toolbar, "plus", "New question").addEventListener("click", () => void this.selectQuestion(null));
		if (this.saved) iconAction(toolbar, "trash-2", "Delete question").addEventListener("click", () => void this.delete());
		toolbar.createDiv({ cls: "examiner-spacer" });
		if (this.saved) textButton(toolbar, "Practice").addEventListener("click", () => void this.practice());
		this.discardButton = textButton(toolbar, "Discard changes");
		this.discardButton.addEventListener("click", () => void this.discard());
		this.saveButton = textButton(toolbar, "Save", true);
		this.saveButton.addEventListener("click", () => void this.save());
		this.updateSaveState();
	}

	private updateSaveState(): void {
		const dirty = this.isDirty();
		if (this.saveButton) this.saveButton.disabled = !dirty;
		if (this.discardButton) this.discardButton.disabled = !dirty;
	}

	private renderProblems(): void {
		this.problemsEl.empty();
		const problems = this.plugin.questions.problems();
		if (problems.length === 0) return;
		const details = this.problemsEl.createEl("details", { cls: "examiner-problems" });
		details.createEl("summary", {
			text: problems.length === 1 ? "1 question file needs attention" : `${problems.length} question files need attention`,
		});
		for (const problem of problems) {
			const row = details.createDiv({ cls: "examiner-problem" });
			row.createEl("code", { text: problem.path });
			for (const error of problem.errors) row.createDiv({ cls: "examiner-error-text", text: error });
			if (problem.duplicateOf !== undefined) {
				const button = row.createEl("button", { text: "Give it a new ID" });
				button.addEventListener("click", () => void this.plugin.questions.assignNewId(problem.path, createId("q")));
			}
		}
	}

	private renderForm(): void {
		this.promptEditor?.destroy();
		this.promptEditor = null;
		this.formEl.empty();
		this.issueSlots = new Map();
		this.inputsByPath = new Map();
		if (!this.plugin.ready) return;
		this.formRendered = true;
		this.calculatedEl = null;
		this.imagesEl = null;
		this.renderDetailsSection();
		if (this.draft.kind === "flashcard") {
			this.renderFlashcardQuestionSection();
			this.renderFlashcardAnswerSection();
		} else {
			this.renderPromptSection();
			this.renderVariablesSection();
			this.renderStepsSection();
			this.renderAnswerSection();
		}
		this.renderTagsSection();
	}

	private section(id: string, title: string): HTMLElement {
		const details = this.formEl.createEl("details", { cls: "examiner-section" });
		details.open = !this.collapsed.has(id);
		details.addEventListener("toggle", () => {
			if (details.open) this.collapsed.delete(id);
			else this.collapsed.add(id);
		});
		details.createEl("summary", { cls: "examiner-section-title", text: title });
		return details.createDiv({ cls: "examiner-section-body" });
	}

	private slot(parent: HTMLElement, path: string): void {
		this.issueSlots.set(path, parent.createDiv({ cls: "examiner-field-issues" }));
	}

	private changed(rerender = false): void {
		if (rerender) this.renderForm();
		this.refreshDiagnostics();
	}

	private textInput(parent: HTMLElement, path: string, value: string, onInput: (value: string) => void, cls = ""): HTMLInputElement {
		const input = parent.createEl("input", { type: "text", cls, value });
		input.spellcheck = false;
		input.addEventListener("input", () => {
			onInput(input.value);
			this.changed();
		});
		this.inputsByPath.set(path, input);
		return input;
	}

	private labelledField(parent: HTMLElement, label: string, path: string, value: string, onInput: (value: string) => void): HTMLInputElement {
		const field = parent.createEl("label", { cls: "examiner-field" });
		field.createSpan({ cls: "examiner-field-label", text: label });
		return this.textInput(field, path, value, onInput, "examiner-number-input");
	}

	private renderDetailsSection(): void {
		const body = this.section("details", "Details");
		const typeRow = body.createDiv({ cls: "examiner-row-fields" });
		const typeField = typeRow.createEl("label", { cls: "examiner-field" });
		typeField.createSpan({ cls: "examiner-field-label", text: "Question type" });
		new DropdownComponent(typeField)
			.addOptions(QUESTION_KIND_LABELS)
			.setValue(this.draft.kind)
			.onChange((kind) => {
				this.draft.kind = kind as QuestionKind;
				if (this.draft.kind === "flashcard") this.draft.tags = withoutDefaultTags(this.draft.tags);
				this.changed(true);
			});
		this.labelledField(typeRow, "Marks", "marks", showNumber(this.draft.marks), (text) => (this.draft.marks = readNumberField(text)));
		this.slot(body, "marks");

		const field = body.createEl("label", { cls: "examiner-field examiner-field-wide" });
		field.createSpan({ cls: "examiner-field-label", text: "Title" });
		const title = this.textInput(field, "title", this.draft.title, (value) => (this.draft.title = value));
		title.placeholder = this.draft.kind === "flashcard" ? "For example, resonant frequency" : "For example, area of a circle";
		this.slot(body, "title");
	}

	private textArea(parent: HTMLElement, path: string, value: string, onInput: (value: string) => void): HTMLTextAreaElement {
		const area = parent.createEl("textarea", { cls: "examiner-textarea", attr: { rows: "3" } });
		area.value = value;
		area.addEventListener("input", () => {
			onInput(area.value);
			this.changed();
		});
		this.inputsByPath.set(path, area);
		return area;
	}

	private renderFlashcardQuestionSection(): void {
		const body = this.section("flashcard-question", "Question");
		const area = this.textArea(body, "prompt", this.draft.prompt, (value) => (this.draft.prompt = value));
		area.setAttribute("aria-label", "Question");
		area.placeholder = "What is resonant frequency?";
		this.slot(body, "prompt");
		this.renderImagesField(body);
	}

	private renderImagesField(body: HTMLElement): void {
		body.createDiv({ cls: "examiner-field-label", text: "Images" });
		this.imagesEl = body.createDiv({ cls: "examiner-attachments" });
		this.renderImages();
	}

	private renderImages(): void {
		if (!this.imagesEl) return;
		renderAttachmentPicker(this.imagesEl, {
			names: this.draft.images ?? [],
			hint: "Drop images here",
			accept: "image/*",
			onFiles: (files) => void this.uploadImages(files),
			onRemove: (name) => {
				const remaining = (this.draft.images ?? []).filter((entry) => entry !== name);
				if (remaining.length > 0) this.draft.images = remaining;
				else delete this.draft.images;
				this.renderImages();
				this.changed();
			},
		});
	}

	private async uploadImages(files: readonly File[]): Promise<void> {
		const draft = this.draft;
		const added = await addAttachments(this.plugin.questionImageAccess, draft.id, files, draft.images ?? [], ["image"]);
		if (added.length > 0) draft.images = [...(draft.images ?? []), ...added];
		if (draft !== this.draft) return;
		this.renderImages();
		this.changed();
	}

	private async discardUploads(): Promise<void> {
		const stored = this.plugin.questions.get(this.draft.id);
		await this.plugin.questionImages.prune(this.draft.id, stored?.images ?? []).catch((error: unknown) => {
			console.error("Examiner: could not tidy up unsaved question images", error);
		});
	}

	private async copyImages(fromId: string, toId: string, names: readonly string[]): Promise<string[]> {
		const copied: string[] = [];
		for (const name of names) {
			if (isVaultReference(name)) {
				copied.push(name);
				continue;
			}
			try {
				copied.push(await this.plugin.questionImages.add(toId, name, await this.plugin.questionImages.read(fromId, name), copied));
			} catch (error) {
				console.error(`Examiner: could not copy the image ${name}`, error);
				new Notice(`Could not copy the image ${name} to the new question.`);
			}
		}
		return copied;
	}

	private renderFlashcardAnswerSection(): void {
		const body = this.section("flashcard-answer", "Answer");
		const card = this.draft.flashcard;
		const row = body.createDiv({ cls: "examiner-row-fields" });
		const modeField = row.createEl("label", { cls: "examiner-field" });
		modeField.createSpan({ cls: "examiner-field-label", text: "Answer mode" });
		new DropdownComponent(modeField)
			.addOptions(FLASHCARD_MODE_LABELS)
			.setValue(card.mode)
			.onChange((mode) => {
				card.mode = mode as FlashcardMode;
				this.changed(true);
			});

		if (card.mode === "written") {
			const field = body.createEl("label", { cls: "examiner-field examiner-field-wide" });
			field.createSpan({ cls: "examiner-field-label", text: "Expected answer" });
			this.textArea(field, "flashcard.answer", card.answer, (value) => (card.answer = value));
			this.slot(body, "flashcard.answer");
			return;
		}

		body.createDiv({ cls: "examiner-field-label", text: "Options" });
		const list = body.createDiv({ cls: "examiner-options", attr: { role: "radiogroup", "aria-label": "Correct option" } });
		const group = `examiner-correct-${this.draft.id}`;
		card.options.forEach((option, index) => {
			const optionRow = list.createDiv({ cls: "examiner-row examiner-option-row" });
			const radio = optionRow.createEl("input", { type: "radio", attr: { name: group, "aria-label": `Option ${index + 1} is correct` } });
			radio.checked = card.correct === index;
			setTooltip(radio, "Correct option");
			radio.addEventListener("change", () => {
				card.correct = index;
				this.changed();
			});
			const input = this.textInput(optionRow, `flashcard.options.${index}`, option, (value) => (card.options[index] = value), "examiner-option-input");
			input.setAttribute("aria-label", `Option ${index + 1}`);
			input.placeholder = `Option ${index + 1}`;
			const remove = optionRow.createDiv({ cls: "examiner-row-actions" }).createEl("button", {
				cls: "clickable-icon",
				attr: { "aria-label": "Remove option" },
			});
			setIcon(remove, "x");
			setTooltip(remove, "Remove option");
			remove.addEventListener("click", () => {
				card.options.splice(index, 1);
				if (card.correct === index) card.correct = -1;
				else if (card.correct > index) card.correct--;
				this.changed(true);
			});
			this.slot(list, `flashcard.options.${index}`);
		});
		this.slot(body, "flashcard.options");
		const add = body.createEl("button", { text: "Add option" });
		add.addEventListener("click", () => {
			card.options.push("");
			this.changed(true);
		});
	}

	private renderPromptSection(): void {
		const body = this.section("prompt", "Question");
		body.createDiv({ cls: "examiner-muted examiner-small", text: "Write {variable} to insert a value." });
		const container = body.createDiv({ cls: "examiner-prompt-editor" });
		this.promptEditor = createPromptEditor(container, this.draft.prompt, (text) => {
			this.draft.prompt = text;
			this.changed();
		});
		this.inputsByPath.set("prompt", container);
		this.slot(body, "prompt");
		this.renderImagesField(body);
	}

	private renderVariablesSection(): void {
		const body = this.section("variables", "Variables");
		if (this.draft.variables.length === 0) {
			body.createDiv({ cls: "examiner-muted", text: "No input variables yet. Add one for each value that should change between attempts." });
		}
		this.draft.variables.forEach((variable, index) => this.renderVariableRow(body, variable, index));
		const add = body.createEl("button", { text: "Add variable" });
		add.addEventListener("click", () => {
			this.draft.variables.push({ name: this.nextVariableName(), source: { kind: "integer", min: 1, max: 10 } });
			this.changed(true);
		});

		const calculated = body.createDiv({ cls: "examiner-subsection" });
		calculated.createDiv({ cls: "examiner-subsection-title", text: "Calculated values" });
		this.calculatedEl = calculated.createDiv();
	}

	private nextVariableName(): string {
		const taken = new Set([...this.draft.variables.map((v) => v.name), ...this.draft.steps.map((s) => s.target)]);
		for (const name of ["x", "y", "z", "a", "b", "c", "d", "n", "m", "p", "q", "r", "s", "t", "u", "v", "w"]) {
			if (!taken.has(name)) return name;
		}
		let n = 1;
		while (taken.has(`v${n}`)) n++;
		return `v${n}`;
	}

	private renderVariableRow(parent: HTMLElement, variable: InputVariable, index: number): void {
		const path = `variables.${index}`;
		const row = parent.createDiv({ cls: "examiner-row examiner-variable-row" });
		this.makeDraggable(row, this.draft.variables, index, "variable");
		const fields = row.createDiv({ cls: "examiner-row-fields" });

		const nameField = fields.createEl("label", { cls: "examiner-field" });
		nameField.createSpan({ cls: "examiner-field-label", text: "Name" });
		const nameWrap = nameField.createDiv({ cls: "examiner-braced" });
		const name = this.textInput(nameWrap, `${path}.name`, variable.name, (value) => (variable.name = value.trim()), "examiner-name-input");
		name.setAttribute("aria-label", "Variable name");

		const typeField = fields.createEl("label", { cls: "examiner-field" });
		typeField.createSpan({ cls: "examiner-field-label", text: "Type" });
		new DropdownComponent(typeField)
			.addOptions(VARIABLE_KIND_LABELS)
			.setValue(variable.source.kind)
			.onChange((kind) => {
				variable.source = convertSource(variable.source, kind as VariableKind);
				this.changed(true);
			});

		const source = variable.source;
		if (source.kind === "fixed") {
			this.labelledField(fields, "Value", `${path}.value`, showNumber(source.value), (text) => (source.value = readNumberField(text)));
		} else {
			this.labelledField(fields, "Minimum", `${path}.min`, showNumber(source.min), (text) => (source.min = readNumberField(text)));
			this.labelledField(fields, "Maximum", `${path}.max`, showNumber(source.max), (text) => (source.max = readNumberField(text)));
			if (source.kind === "decimal") {
				this.labelledField(fields, "Decimal places", `${path}.places`, showNumber(source.places), (text) => (source.places = readNumberField(text)));
			}
		}

		this.rowActions(row, this.draft.variables, index, "variable");
		this.slot(parent, path);
	}

	private makeDraggable<T>(row: HTMLElement, list: T[], index: number, noun: string): void {
		row.addClass("examiner-draggable-row");
		const label = `Drag to reorder ${noun} ${index + 1}`;
		const handle = row.createEl("button", {
			cls: "clickable-icon examiner-drag-handle",
			attr: { "aria-label": `${label}, or use the arrow keys`, "data-drag-handle": `${noun}-${index}` },
		});
		setIcon(handle, "grip-vertical");
		setTooltip(handle, label);
		const clearDropMarks = () => {
			for (const marked of Array.from(this.formEl.querySelectorAll(".is-drop-before, .is-drop-after"))) {
				marked.removeClass("is-drop-before", "is-drop-after");
			}
		};
		const dropAfter = (event: DragEvent) => {
			const rect = row.getBoundingClientRect();
			return event.clientY > rect.top + rect.height / 2;
		};

		handle.addEventListener("pointerdown", () => {
			row.draggable = true;
			row.doc.addEventListener("pointerup", () => (row.draggable = false), { once: true });
		});

		handle.addEventListener("keydown", (event) => {
			const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
			const target = index + offset;
			if (offset === 0 || target < 0 || target >= list.length) return;
			event.preventDefault();
			this.moveItem(list, index, target);
			this.formEl.querySelector<HTMLElement>(`[data-drag-handle="${noun}-${target}"]`)?.focus();
		});
		row.addEventListener("dragstart", (event) => {
			if (!row.draggable) {
				event.preventDefault();
				return;
			}
			this.dragging = { list, index };
			event.dataTransfer?.setData("text/plain", String(index));
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
			row.addClass("is-dragging");
		});
		row.addEventListener("dragover", (event) => {
			if (this.dragging?.list !== list) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			const after = dropAfter(event);
			clearDropMarks();
			if (this.dragging.index !== index) row.addClass(after ? "is-drop-after" : "is-drop-before");
		});
		row.addEventListener("dragleave", (event) => {
			if (!row.contains(event.relatedTarget as Node | null)) row.removeClass("is-drop-before", "is-drop-after");
		});
		row.addEventListener("drop", (event) => {
			if (this.dragging?.list !== list) return;
			const from = this.dragging.index;
			event.preventDefault();
			clearDropMarks();
			this.dragging = null;
			let to = index + (dropAfter(event) ? 1 : 0);
			if (from < to) to--;
			if (from !== to) this.moveItem(list, from, to);
		});
		row.addEventListener("dragend", () => {
			this.dragging = null;
			row.draggable = false;
			row.removeClass("is-dragging");
			clearDropMarks();
		});
	}

	private moveItem<T>(list: T[], from: number, to: number): void {
		const [item] = list.splice(from, 1);
		if (item === undefined) return;
		list.splice(to, 0, item);
		this.changed(true);
	}

	private rowActions<T>(row: HTMLElement, list: T[], index: number, noun: string): void {
		const actions = row.createDiv({ cls: "examiner-row-actions" });
		const action = (icon: string, label: string, disabled: boolean, run: () => void) => {
			const button = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(button, icon);
			setTooltip(button, label);
			button.disabled = disabled;
			button.addEventListener("click", () => {
				run();
				this.changed(true);
			});
		};
		action("x", `Remove ${noun}`, false, () => list.splice(index, 1));
	}

	private renderStepsSection(): void {
		const body = this.section("steps", "Formula steps");
		this.draft.steps.forEach((step, index) => {
			const path = `steps.${index}`;
			const row = body.createDiv({ cls: "examiner-row examiner-step" });
			this.makeDraggable(row, this.draft.steps, index, "step");
			row.createSpan({ cls: "examiner-step-number", text: String(index + 1) });
			const fields = row.createDiv({ cls: "examiner-row-fields examiner-step-fields" });
			const targetWrap = fields.createDiv({ cls: "examiner-braced" });
			const target = this.textInput(targetWrap, `${path}.target`, step.target, (value) => (step.target = value.trim()), "examiner-name-input");
			target.setAttribute("aria-label", `Step ${index + 1} result variable`);
			fields.createSpan({ cls: "examiner-equals", text: "=" });
			const expression = this.textInput(fields, `${path}.expression`, step.expression, (value) => (step.expression = value), "examiner-expression-input");
			expression.setAttribute("aria-label", `Step ${index + 1} expression`);
			expression.placeholder = "{x} + {y}";
			this.rowActions(row, this.draft.steps, index, "step");
			this.slot(body, path);
		});
		this.slot(body, "steps");
		const add = body.createEl("button", { text: "Add step" });
		add.addEventListener("click", () => {
			const hasAnswer = this.draft.steps.some((step) => step.target === ANSWER_VARIABLE);
			this.draft.steps.push({ target: hasAnswer ? this.nextVariableName() : ANSWER_VARIABLE, expression: "" });
			this.changed(true);
		});
		this.renderReference(body);
	}

	private renderReference(parent: HTMLElement): void {
		const details = parent.createEl("details", { cls: "examiner-reference" });
		details.createEl("summary", { text: "Operators and functions" });
		const list = details.createEl("dl");
		const entry = (term: string, description: string) => {
			list.createEl("dt").createEl("code", { text: term });
			list.createEl("dd", { text: description });
		};
		entry("+ - * /", "Add, subtract, multiply, divide");
		entry("^", "Power. Evaluated right to left, so 2^3^2 is 2^9, and -2^2 is -4.");
		entry("( )", "Grouping");
		for (const [name, fn] of Object.entries(FUNCTIONS)) {
			const args = fn.maxArgs === Infinity ? "a, b, …" : fn.maxArgs === 2 ? "x, base" : "x";
			entry(`${name}(${args})`, fn.description);
		}
		for (const [name, value] of Object.entries(CONSTANTS)) entry(name, `The constant ${formatNumber(value)}`);
		details.createDiv({
			cls: "examiner-muted examiner-small",
			text: "Trigonometric functions use radians. Convert with rad() and deg(), for example sin(rad(30)).",
		});
	}

	private renderAnswerSection(): void {
		const body = this.section("answer", "Answer");
		const rule = this.draft.answer;
		const row = body.createDiv({ cls: "examiner-row-fields" });
		const checkField = row.createEl("label", { cls: "examiner-field" });
		checkField.createSpan({ cls: "examiner-field-label", text: "Check answers" });
		new DropdownComponent(checkField)
			.addOptions(ANSWER_CHECK_LABELS)
			.setValue(rule.check)
			.onChange((check) => {
				this.draft.answer = this.defaultRule(check as AnswerRule["check"]);
				this.changed(true);
			});

		if (rule.check === "rounded") {
			this.labelledField(row, "Decimal places", "answer.places", showNumber(rule.places), (text) => (rule.places = readNumberField(text)));
		} else if (rule.check === "absolute") {
			this.labelledField(row, "Tolerance (±)", "answer.tolerance", showNumber(rule.tolerance), (text) => (rule.tolerance = readNumberField(text)));
		} else if (rule.check === "relative") {
			this.labelledField(row, "Tolerance (±%)", "answer.tolerance", showNumber(rule.percent), (text) => (rule.percent = readNumberField(text)));
		}
		this.slot(body, "answer");
		const scientific = body.createEl("label", { cls: "examiner-checkbox-field" });
		const checkbox = scientific.createEl("input", { type: "checkbox" });
		checkbox.checked = this.draft.scientific === true;
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) this.draft.scientific = true;
			else delete this.draft.scientific;
			this.changed();
		});
		scientific.createSpan({ text: "Show answer in scientific notation" });
	}

	private defaultRule(check: AnswerRule["check"]): AnswerRule {
		switch (check) {
			case "exact":
				return { check };
			case "rounded":
				return { check, places: 2 };
			case "absolute":
				return { check, tolerance: 0.01 };
			case "relative":
				return { check, percent: 1 };
		}
	}

	private renderTagsSection(): void {
		const body = this.section("tags", "Tags");
		const knownTags = () => this.plugin.questions.definitions().flatMap((question) => question.tags);
		renderTagEditor(this.app, body, this.draft.tags, knownTags, (tags) => {
			this.draft.tags = tags;
			this.changed();
		});
	}

	private refreshDiagnostics(): void {
		this.updateSaveState();
		if (!this.plugin.ready) return;
		const issues = validateDefinition(this.draft);

		for (const element of this.inputsByPath.values()) element.removeClass("examiner-invalid");
		for (const issue of issues) {
			if (issue.severity === "error") this.inputsByPath.get(issue.path)?.addClass("examiner-invalid");
		}
		for (const [prefix, slot] of this.issueSlots) {
			slot.empty();
			for (const issue of issues) {
				if (this.slotFor(issue.path) === prefix) this.renderIssue(slot, issue);
			}
		}

		this.renderCalculatedValues();
		this.renderIssueSummary(issues);
		this.schedulePreview();
	}

	private slotFor(path: string): string {
		const [section, index] = path.split(".");
		if (section === "flashcard") return path;
		if ((section === "variables" || section === "steps") && index !== undefined) return `${section}.${index}`;
		return section ?? path;
	}

	private renderIssue(parent: HTMLElement, issue: ValidationIssue): void {
		parent.createDiv({ cls: issue.severity === "error" ? "examiner-error-text" : "examiner-warning-text", text: issue.message });
	}

	private renderCalculatedValues(): void {
		const el = this.calculatedEl;
		if (!el) return;
		el.empty();
		const inputs = new Set(this.draft.variables.map((variable) => variable.name));
		const seen = new Set<string>();
		this.draft.steps.forEach((step, index) => {
			if (step.target === "" || step.target === ANSWER_VARIABLE || inputs.has(step.target) || seen.has(step.target)) return;
			seen.add(step.target);
			const row = el.createDiv({ cls: "examiner-calculated" });
			row.createEl("code", { text: `{${step.target}}` });
			row.createSpan({ cls: "examiner-muted", text: `Calculated in step ${index + 1}` });
		});
		const answerStep = this.draft.steps.findIndex((step) => step.target === ANSWER_VARIABLE);
		const row = el.createDiv({ cls: "examiner-calculated" });
		row.createEl("code", { text: "{answer}" });
		if (answerStep !== -1) row.createSpan({ cls: "examiner-muted", text: `Calculated in step ${answerStep + 1}` });
	}

	private renderIssueSummary(issues: ValidationIssue[]): void {
		const el = this.issuesEl;
		el.empty();
		if (!this.plugin.ready || issues.length === 0) return;
		const errors = issues.filter((issue) => issue.severity === "error").length;
		const warnings = issues.length - errors;
		const parts = [];
		if (errors > 0) parts.push(errors === 1 ? "1 error" : `${errors} errors`);
		if (warnings > 0) parts.push(warnings === 1 ? "1 warning" : `${warnings} warnings`);
		const block = section(el, "Validation", parts.join(", "));
		if (this.draft.kind === "flashcard") return;
		block.createDiv({

			cls: "examiner-muted examiner-small",
			text:
				errors > 0
					? "Details are shown beside each field. Questions with errors cannot be practiced or used in exams."
					: "Details are shown beside each field.",
		});
	}

	private async renderPreview(): Promise<void> {
		const token = ++this.previewToken;
		const el = this.previewEl;
		if (!this.plugin.ready) {
			el.empty();
			return;
		}
		const definition = structuredClone(this.draft);
		if (definition.kind === "flashcard") {
			await this.renderFlashcardPreview(definition, token);
			return;
		}
		const box = createDiv({ cls: "examiner-block" });
		const heading = box.createDiv({ cls: "examiner-block-heading" });
		heading.createSpan({ cls: "examiner-block-title", text: "Preview" });
		const regenerate = iconAction(heading, "refresh-cw", "New values");
		regenerate.addEventListener("click", () => {
			this.previewSeed = randomSeed();
			void this.renderPreview();
		});

		if (hasErrors(validateDefinition(definition))) {
			regenerate.disabled = true;
			box.createDiv({ cls: "examiner-muted", text: "Fix the errors to see a preview." });
			el.replaceChildren(box);
			return;
		}

		let instance;
		try {
			instance = generateInstance(definition, seededRandom(this.previewSeed));
		} catch (error) {
			if (!(error instanceof GenerationError)) throw error;
			box.createDiv({ cls: "examiner-error-text", text: error.message });
			el.replaceChildren(box);
			return;
		}

		const surface = box.createDiv({ cls: "examiner-question is-preview" });
		await renderMarkdown(this.app, surface.createDiv({ cls: "examiner-prompt" }), instance.prompt, this);
		if (token !== this.previewToken) return;
		renderQuestionImages(surface, this.plugin.questionImageAccess, definition.id, definition.images);
		const instruction = answerInstruction(definition.answer);
		if (instruction) surface.createDiv({ cls: "examiner-instruction", text: instruction });

		const table = box.createEl("table", { cls: "examiner-table" });
		const tbody = table.createEl("tbody");
		for (const variable of definition.variables) {
			const tr = tbody.createEl("tr");
			tr.createEl("td").createEl("code", { text: `{${variable.name}}` });
			tr.createEl("td", { text: formatVariableValue(variable.source, instance.inputs[variable.name] ?? Number.NaN) });
		}
		const answerRow = tbody.createEl("tr", { cls: "examiner-answer-row" });
		answerRow.createEl("td", { text: "Expected answer" });
		answerRow.createEl("td", { text: formatExpectedAnswer(definition.answer, instance.answer, definition.scientific) });

		renderWorking(box, workedSteps(instance), true);

		const probe = probeDefinition(definition);
		if (probe && probe.failureRate >= 1) {
			box.createDiv({ cls: "examiner-warning-text", text: `No generated values work. ${probe.example.message}` });
		}
		el.replaceChildren(box);
	}

	private async renderFlashcardPreview(definition: QuestionDefinition, token: number): Promise<void> {
		const box = createDiv({ cls: "examiner-block" });
		box.createDiv({ cls: "examiner-block-heading" }).createSpan({ cls: "examiner-block-title", text: "Preview" });
		if (hasErrors(validateDefinition(definition))) {
			box.createDiv({ cls: "examiner-muted", text: "Fix the errors to see a preview." });
			this.previewEl.replaceChildren(box);
			return;
		}
		const surface = box.createDiv({ cls: "examiner-question is-preview" });
		await renderMarkdown(this.app, surface.createDiv({ cls: "examiner-prompt" }), definition.prompt, this);
		if (token !== this.previewToken) return;
		renderQuestionImages(surface, this.plugin.questionImageAccess, definition.id, definition.images);
		const tbody = box.createEl("table", { cls: "examiner-table" }).createEl("tbody");
		const card = definition.flashcard;
		if (card.mode === "choice") {
			card.options.forEach((option, index) => {
				const row = tbody.createEl("tr", { cls: index === card.correct ? "examiner-answer-row" : "" });
				row.createEl("td", { text: index === card.correct ? "Correct" : `Option ${index + 1}` });
				row.createEl("td", { cls: "examiner-wrap", text: option });
			});
		} else {
			const row = tbody.createEl("tr", { cls: "examiner-answer-row" });
			row.createEl("td", { text: "Expected answer" });
			row.createEl("td", { cls: "examiner-wrap", text: card.answer });
		}
		const marks = tbody.createEl("tr");
		marks.createEl("td", { text: "Marks" });
		marks.createEl("td", { text: String(definition.marks) });
		this.previewEl.replaceChildren(box);
	}

	private async save(): Promise<void> {
		if (this.saving || (!this.isDirty() && this.saved)) return;
		const definition: QuestionDefinition = {
			...structuredClone(this.draft),
			title: this.draft.title.trim(),
			prompt: this.draft.prompt.trim(),
			tags: normaliseTags(this.draft.tags),
		};
		const stored = this.plugin.questions.get(definition.id) ?? null;
		const action = questionSaveAction(stored, definition.title);
		const originalId = definition.id;
		if (action === "copy") definition.id = createId("q");
		this.saving = true;
		try {
			if (action === "copy" && definition.images) {
				const images = await this.copyImages(originalId, definition.id, definition.images);
				if (images.length > 0) definition.images = images;
				else delete definition.images;
			}
			if (action === "update") await this.plugin.questions.save(definition);
			else await this.plugin.questions.create(definition);
		} catch (error) {
			new Notice(`Could not save the question: ${error instanceof Error ? error.message : String(error)}`);
			return;
		} finally {
			this.saving = false;
		}
		await this.plugin.questionImages.prune(definition.id, definition.images ?? []).catch((error: unknown) => {
			console.error("Examiner: could not tidy up removed question images", error);
		});
		if (action === "copy") {
			await this.plugin.questionImages.prune(originalId, stored?.images ?? []).catch((error: unknown) => {
				console.error("Examiner: could not tidy up the original question's images", error);
			});
		}
		this.loadQuestion(this.plugin.questions.get(definition.id) ?? definition);
		this.render();
		this.app.workspace.requestSaveLayout();
		const label = definition.title || "Untitled question";
		const saved = action === "copy" ? `Saved "${label}" as a new question. "${stored?.title || "Untitled question"}" was kept.` : `Saved "${label}".`;
		new Notice(hasErrors(validateDefinition(definition)) ? `${saved} Fix its errors before practicing it.` : saved);
	}

	private async discard(): Promise<void> {
		if (!(await this.confirmDiscard())) return;
		await this.discardUploads();
		this.loadQuestion(this.saved ? (this.plugin.questions.get(this.saved.id) ?? this.saved) : null);
		this.render();
	}

	private async delete(): Promise<void> {
		if (!this.saved) return;
		const title = this.saved.title || "Untitled question";
		const confirmed = await confirm(this.app, {
			title: `Delete "${title}"?`,
			message: "Its file will be moved to the trash. Exams that use it will skip it.",
			confirmText: "Delete",
			destructive: true,
		});
		if (!confirmed) return;
		this.saving = true;
		try {
			await this.plugin.questions.delete(this.saved.id);
			await this.plugin.questionImages.removeOwner(this.saved.id).catch((error: unknown) => {
				console.error("Examiner: could not delete the question's images", error);
			});
		} finally {
			this.saving = false;
		}

		this.loadQuestion(this.plugin.questions.definitions()[0] ?? null);
		this.render();
		new Notice(`Deleted "${title}".`);
	}

	private async practice(): Promise<void> {
		if (!this.saved) return;
		if (this.isDirty()) {
			new Notice("Save your changes before practicing this question.");
			return;
		}
		if (hasErrors(validateDefinition(this.saved))) {
			new Notice("Fix the errors in this question before practicing it.");
			return;
		}
		await this.plugin.openPractice(this.saved.id);
	}
}
