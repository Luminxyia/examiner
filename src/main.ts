import { loadMathJax, normalizePath, Notice, Plugin, type ViewState } from "obsidian";
import { hasErrors, validateDefinition, type QuestionDefinition } from "./core/definition";
import type { ExamDefinition } from "./core/exam";
import { StudyTracker } from "./core/study-time";
import { EXAMPLE_QUESTION } from "./example";
import { DEFAULT_SETTINGS, type ExaminerSettings } from "./settings";
import { parseExamFile, serializeExam } from "./storage/exam-format";
import { createId, fileKindOf } from "./storage/format-shared";
import { DefinitionLibrary } from "./storage/library";
import { parseQuestionFile, serializeQuestion } from "./storage/question-format";
import { ResultsStore } from "./storage/results";
import { AttachmentStore } from "./storage/attachments";
import { LoadState } from "./storage/load-state";
import { AdapterFolderFiles } from "./storage/plugin-files";
import { AttemptView, VIEW_TYPE_ATTEMPT, type AttemptViewState } from "./ui/attempt-view";
import { ExamEditorView, VIEW_TYPE_EXAM_EDITOR, type ExamEditorState } from "./ui/exam-editor-view";
import { ExamPickerModal } from "./ui/exam-picker";
import { ExamSessionView, VIEW_TYPE_EXAM_SESSION } from "./ui/exam-session-view";
import { OverviewView, VIEW_TYPE_OVERVIEW } from "./ui/overview-view";
import { ExamsView, VIEW_TYPE_EXAMS } from "./ui/exams-view";
import { ExaminerSettingTab } from "./ui/settings-tab";
import { PracticeView, VIEW_TYPE_PRACTICE, type PracticeViewState } from "./ui/practice-view";
import { QuestionEditorView, VIEW_TYPE_QUESTION_EDITOR, type EditorDraft, type QuestionEditorState } from "./ui/question-editor-view";
import { QuestionPickerModal } from "./ui/question-picker";

export default class ExaminerPlugin extends Plugin {
	override settings: ExaminerSettings = { ...DEFAULT_SETTINGS };
	questions!: DefinitionLibrary<QuestionDefinition>;
	exams!: DefinitionLibrary<ExamDefinition>;
	results!: ResultsStore;
	attachments!: AttachmentStore;
	private tracker!: StudyTracker;
	private pendingStudyWrite: Promise<void> = Promise.resolve();
	readonly loadState = new LoadState();
	unsavedDraft: EditorDraft | null = null;
	pendingExamDraft: ExamDefinition | null = null;

	override async onload(): Promise<void> {
		await this.loadSettings();

		const pluginFolder = this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		const files = new AdapterFolderFiles(this.app.vault.adapter);
		this.questions = new DefinitionLibrary(
			files,
			{ kind: "question", parse: parseQuestionFile, serialize: serializeQuestion },
			`${pluginFolder}/questions`,
		);
		this.exams = new DefinitionLibrary(files, { kind: "exam", parse: parseExamFile, serialize: serializeExam }, `${pluginFolder}/exams`);
		this.results = new ResultsStore(this.app.vault.adapter, pluginFolder);
		this.attachments = new AttachmentStore(this.app.vault.adapter, `${pluginFolder}/attachments`);

		this.registerView(VIEW_TYPE_QUESTION_EDITOR, (leaf) => new QuestionEditorView(leaf, this));
		this.registerView(VIEW_TYPE_PRACTICE, (leaf) => new PracticeView(leaf, this));
		this.registerView(VIEW_TYPE_EXAMS, (leaf) => new ExamsView(leaf, this));
		this.registerView(VIEW_TYPE_EXAM_SESSION, (leaf) => new ExamSessionView(leaf, this));
		this.registerView(VIEW_TYPE_OVERVIEW, (leaf) => new OverviewView(leaf, this));
		this.registerView(VIEW_TYPE_ATTEMPT, (leaf) => new AttemptView(leaf, this));
		this.registerView(VIEW_TYPE_EXAM_EDITOR, (leaf) => new ExamEditorView(leaf, this));

		this.addCommand({
			id: "open-question-editor",
			name: "Create new practice question",
			callback: () => void this.createQuestion(),
		});
		this.addCommand({
			id: "practice-question",
			name: "Practice a question",
			callback: () => this.choosePracticeQuestion(),
		});
		this.addCommand({
			id: "open-exams",
			name: "Open exams",
			callback: () => void this.openExams(),
		});

		this.addCommand({
			id: "create-exam",
			name: "Create new exam",
			callback: () => void this.editExam(),
		});

		this.addCommand({
			id: "edit-exam",
			name: "Edit exam",
			callback: () => this.chooseExamToEdit(),
		});

		this.addCommand({
			id: "open-overview",
			name: "Open study overview",
			callback: () => void this.openOverview(),
		});

		this.addSettingTab(new ExaminerSettingTab(this));
		this.startStudyTracking();
		this.app.workspace.onLayoutReady(() => void this.initialiseLibraries());
	}

	override onunload(): void {
		this.tracker.setContext(null);
	}

	private startStudyTracking(): void {
		this.tracker = new StudyTracker(
			() => Date.now(),
			() => createId("s"),
			(record) => {
				this.pendingStudyWrite = this.results.recordStudySession(record).catch((error: unknown) => {
					console.error("Examiner: could not save study time", error);
				});
			},
		);
		const updateEngaged = () => this.tracker.setEngaged(activeDocument.hasFocus() && activeDocument.visibilityState === "visible");
		const onActivity = () => this.tracker.activity();
		this.registerDomEvent(window, "focus", updateEngaged);
		this.registerDomEvent(window, "blur", updateEngaged);
		this.registerDomEvent(document, "visibilitychange", updateEngaged);
		for (const type of ["keydown", "pointerdown", "pointermove", "wheel"] as const) {
			this.registerDomEvent(document, type, onActivity, { passive: true });
		}
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshStudyContext()));
		updateEngaged();
	}

	refreshStudyContext(): void {
		const { workspace } = this.app;
		const view = workspace.getActiveViewOfType(PracticeView) ?? workspace.getActiveViewOfType(ExamSessionView);
		this.tracker.setContext(view?.studyContext() ?? null);
	}

	async endStudyAndMeasure(attemptId: string): Promise<number> {
		this.tracker.endIf(`exam:${attemptId}`);
		await this.pendingStudyWrite;
		const sessions = await this.results.readStudySessions();
		return sessions.filter((session) => session.attemptId === attemptId).reduce((sum, session) => sum + session.activeMs, 0);
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<ExaminerSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	get ready(): boolean {
		return this.loadState.ready;
	}

	private async initialiseLibraries(): Promise<void> {
		const mathJax = loadMathJax().catch((error: unknown) => console.error("Examiner: could not load MathJax", error));
		await Promise.all([this.loadLibraries(), mathJax]);
	}

	async loadLibraries(): Promise<void> {
		if (this.loadState.loading) return;
		const loaded = await this.loadState.run(async () => {
			try {
				await Promise.all([this.questions.load(), this.exams.load()]);
			} catch (error) {
				console.error("Examiner: could not read stored questions and exams", error);
				throw error;
			}
		});
		if (!loaded) return;
		await this.importVaultFiles();
		await this.createExampleIfNeeded();
	}

	private async importVaultFiles(): Promise<void> {
		if (this.settings.vaultFilesImported) return;
		const moved = { question: 0, exam: 0 };
		for (const file of this.app.vault.getMarkdownFiles()) {
			const kind = fileKindOf(this.app.metadataCache.getFileCache(file)?.frontmatter);
			if (!kind) continue;
			try {
				const library = kind === "question" ? this.questions : this.exams;
				if (await library.import(await this.app.vault.read(file))) {
					await this.app.fileManager.trashFile(file);
					moved[kind]++;
				}
			} catch (error) {
				console.error(`Examiner: could not move ${file.path} into the plugin folder`, error);
			}
		}
		if (moved.question + moved.exam > 0) {
			new Notice(
				`Moved ${plural(moved.question, "question")} and ${plural(moved.exam, "exam")} from your notes into Examiner's plugin folder. The original notes are in the trash.`,
			);
		}
		this.settings.vaultFilesImported = true;
		await this.saveSettings();
	}

	private async createExampleIfNeeded(): Promise<void> {
		if (this.settings.exampleCreated) return;
		try {
			if (!this.questions.get(EXAMPLE_QUESTION.id)) {
				await this.questions.create(EXAMPLE_QUESTION);
			}
			this.settings.exampleCreated = true;
			await this.saveSettings();
		} catch (error) {
			console.error("Examiner: could not create the example question", error);
		}
	}

	async createQuestion(): Promise<void> {
		const state: QuestionEditorState = { newQuestion: true };
		await this.openView({ type: VIEW_TYPE_QUESTION_EDITOR, state: { ...state } });
	}

	async openQuestionEditor(questionId?: string): Promise<void> {

		const state: QuestionEditorState = questionId ? { questionId } : {};
		await this.openView({ type: VIEW_TYPE_QUESTION_EDITOR, state: { ...state } });
	}

	private noticeNotReady(): void {
		new Notice(
			this.loadState.error === null
				? "Examiner is still loading. Try again in a moment."
				: "Examiner could not read its questions and exams. Open the question editor to try again.",
		);
	}

	choosePracticeQuestion(): void {
		if (!this.ready) {
			this.noticeNotReady();
			return;
		}
		const questions = this.usableQuestions();
		if (questions.length === 0) {
			new Notice("There are no questions to practice yet. Create one in the question editor first.");
			return;
		}
		new QuestionPickerModal(this.app, questions, (question) => void this.openPractice(question.id)).open();
	}

	async openPractice(questionId: string): Promise<void> {
		const state: PracticeViewState = { questionId };
		await this.openView({ type: VIEW_TYPE_PRACTICE, state: { ...state } });
	}

	async openExams(): Promise<void> {
		await this.openView({ type: VIEW_TYPE_EXAMS });
	}

	async resetAllData(): Promise<boolean> {
		this.tracker.discard();
		await this.pendingStudyWrite;
		this.unsavedDraft = null;
		this.pendingExamDraft = null;
		const failed: string[] = [];
		const steps: [string, () => Promise<void>][] = [
			["exam results and study history", () => this.results.clearAll()],
			["exams", () => this.exams.clear()],
			["questions", () => this.questions.clear()],
			["reference materials", () => this.attachments.clear()],
		];
		for (const [label, run] of steps) {
			try {
				await run();
			} catch (error) {
				console.error(`Examiner: could not delete ${label}`, error);
				failed.push(label);
			}
		}
		if (failed.length === 0) {
			new Notice("All questions, exams and results have been deleted.");
			return true;
		}
		await Promise.all([this.questions.load(), this.exams.load()]).catch((error: unknown) => {
			console.error("Examiner: could not reload questions and exams", error);
		});
		new Notice(`Examiner could not delete all of its ${failed.join(", ")}. See the developer console for details.`);
		return false;
	}

	chooseExamToEdit(): void {
		if (!this.ready) {
			this.noticeNotReady();
			return;
		}
		const exams = this.exams.definitions();
		if (exams.length === 0) {
			new Notice("There are no exams to edit yet. Create one from the exams view.");
			return;
		}
		new ExamPickerModal(this.app, exams, (exam) => void this.editExam(exam)).open();
	}

	async editExam(exam?: ExamDefinition): Promise<void> {
		const state: ExamEditorState = exam ? { examId: exam.id } : {};
		await this.openView({ type: VIEW_TYPE_EXAM_EDITOR, state: { ...state } });
	}

	async editExamDraft(draft: ExamDefinition): Promise<void> {
		this.pendingExamDraft = draft;
		const state: ExamEditorState = { draft: true };
		await this.openView({ type: VIEW_TYPE_EXAM_EDITOR, state: { ...state } });
	}

	async openExamSession(): Promise<void> {
		await this.openView({ type: VIEW_TYPE_EXAM_SESSION });
	}

	async openOverview(): Promise<void> {
		await this.openView({ type: VIEW_TYPE_OVERVIEW });
	}

	async openAttempt(attemptId: string): Promise<void> {
		const state: AttemptViewState = { attemptId };
		await this.openView({ type: VIEW_TYPE_ATTEMPT, state: { ...state } });
	}

	usableQuestions(): QuestionDefinition[] {
		return this.questions.definitions().filter((question) => this.questionIsUsable(question));
	}

	questionIsUsable(question: QuestionDefinition): boolean {
		return !hasErrors(validateDefinition(question));
	}

	private async openView(viewState: ViewState): Promise<void> {
		const { workspace } = this.app;
		const leaf = workspace.getLeavesOfType(viewState.type)[0] ?? workspace.getLeaf("tab");
		await leaf.setViewState({ ...viewState, active: true });
		await workspace.revealLeaf(leaf);
	}
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
