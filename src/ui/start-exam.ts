import { Notice } from "obsidian";
import { prepareExam, type ExamDefinition } from "../core/exam";
import type ExaminerPlugin from "../main";
import { createId } from "../storage/format-shared";
import { confirm } from "./shared";

export async function startExam(plugin: ExaminerPlugin, exam: ExamDefinition): Promise<void> {
	const existing = await plugin.results.loadSession();
	if (existing) {
		const replace = await confirm(plugin.app, {
			title: "Abandon the exam in progress?",
			message: `"${existing.examTitle}" has not been submitted. Starting a new exam discards its answers.`,
			confirmText: "Start new exam",
			destructive: true,
		});
		if (!replace) return;
	}

	const preparation = prepareExam(exam, (id) => plugin.questions.get(id));
	if (preparation.items.length === 0) {
		new Notice("This exam has no usable questions. Edit it to add some.");
		return;
	}
	const skipped = [
		...preparation.missing.map((id) => `A deleted question (${id})`),
		...preparation.unusable.map((entry) => `${entry.title || "Untitled question"}: ${entry.reason}`),
	];
	if (skipped.length > 0) {
		const message = createFragment((fragment) => {
			fragment.createEl("p", { text: "These questions will be left out:" });
			const list = fragment.createEl("ul");
			for (const line of skipped) list.createEl("li", { text: line });
		});
		const proceed = await confirm(plugin.app, { title: "Some questions will be skipped", message, confirmText: "Start anyway" });
		if (!proceed) return;
	}

	const now = Date.now();
	await plugin.results.saveSession({
		version: 1,
		attemptId: createId("r"),
		examId: exam.id,
		examTitle: exam.title,
		startedAt: new Date(now).toISOString(),
		deadline: exam.timeLimitMinutes === null ? null : now + exam.timeLimitMinutes * 60_000,
		timeLimitMinutes: exam.timeLimitMinutes,
		items: preparation.items,
		responses: preparation.items.map(() => ""),
		current: 0,
	});
	await plugin.openExamSession();
}
