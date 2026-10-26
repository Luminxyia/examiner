import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { examHistory } from "../core/statistics";
import type ExaminerPlugin from "../main";
import { toAttemptSummary, type ExamResultRecord } from "../storage/results";
import { renderExamResult } from "./exam-results";
import { renderEmptyState, textButton } from "./shared";

export const VIEW_TYPE_ATTEMPT = "examiner-attempt";

export interface AttemptViewState {
	attemptId?: string;
}

export class AttemptView extends ItemView {
	private attemptId: string | null = null;
	private record: ExamResultRecord | null = null;
	private renderToken = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExaminerPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_ATTEMPT;
	}

	override getDisplayText(): string {
		return this.record ? `Result: ${this.record.examTitle || "Untitled exam"}` : "Exam result";
	}

	override getIcon(): string {
		return "clipboard-check";
	}

	override getState(): Record<string, unknown> {
		const state: AttemptViewState = this.attemptId ? { attemptId: this.attemptId } : {};
		return { ...state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		this.attemptId = (state as AttemptViewState | null)?.attemptId ?? null;
		await this.render();
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("examiner-view", "examiner-session");
		this.register(this.plugin.results.onChange(() => void this.render()));
		await this.render();

	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = createDiv({ cls: "examiner-session-body" });
		let records: ExamResultRecord[] = [];
		try {
			records = await this.plugin.results.readExamResults();
		} catch (error) {
			console.error("Examiner: could not read exam results", error);
			renderEmptyState(root, "Exam results could not be read. See the developer console for details.");
		}
		if (token !== this.renderToken) return;

		this.record = records.find((record) => record.id === this.attemptId) ?? null;
		if (this.record) {
			const numbered = examHistory(records.map(toAttemptSummary), this.record.examId).find((attempt) => attempt.id === this.attemptId);
			await renderExamResult(this.app, this, root, this.record, {
				attemptLabel: numbered ? `Attempt ${numbered.attemptNumber}` : undefined,
				backLabel: "Back to overview",
				onBack: () => void this.plugin.openOverview(),
				imageAccess: this.plugin.questionImageAccess,
			});
		} else if (records.length > 0 || this.attemptId) {
			renderEmptyState(root, "This attempt could not be found.");
			textButton(root, "Open study overview").addEventListener("click", () => void this.plugin.openOverview());
		}
		if (token !== this.renderToken) return;
		this.contentEl.replaceChildren(root);
	}
}
