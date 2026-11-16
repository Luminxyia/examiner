import { PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { gradeBoundaryIssue } from "../core/grades";
import type ExaminerPlugin from "../main";
import { gradeBoundaries, type ExaminerSettings } from "../settings";
import { confirm } from "./shared";

export class ExaminerSettingTab extends PluginSettingTab {
	private resetting = false;

	constructor(private readonly plugin: ExaminerPlugin) {
		super(plugin.app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Data folder",
				control: { type: "folder", key: "dataFolder", placeholder: "examiner" },
			},
			{
				name: "Reuse files from folder",
				desc: "When you attach a file, Examiner checks this folder and its subfolders for an identical file and links to it instead of making a copy. Leave empty to always make a copy.",
				aliases: ["duplicate", "attachment", "image"],
				control: { type: "folder", key: "reuseFolder", placeholder: "No folder" },
			},
			{
				name: "Reset data",
				desc: "Delete all questions, exams, exam results and study history.",
				aliases: ["delete", "clear", "erase"],
				disabled: () => this.resetting,
				action: () => void this.reset(),
			},
			{
				type: "group",
				heading: "Grade boundaries",
				items: [
					this.gradeSetting("A+", "gradeAPlus"),
					this.gradeSetting("A", "gradeA"),
					this.gradeSetting("B", "gradeB"),
					this.gradeSetting("C", "gradeC"),
					this.gradeSetting("D", "gradeD"),
				],
			},
		];
	}

	private gradeSetting(letter: string, key: keyof ExaminerSettings): SettingDefinition {
		return {
			name: letter,
			aliases: ["grade", "boundary", "letter"],
			control: {
				type: "number",
				key,
				min: 1,
				max: 100,
				step: 1,
				validate: (value) => {
					const candidate = { ...this.plugin.settings, [key]: value };
					const issue = gradeBoundaryIssue(gradeBoundaries(candidate));
					if (issue !== null) return issue;
				},
			},
		};
	}

	private async reset(): Promise<void> {
		if (this.resetting) return;
		const confirmed = await confirm(this.app, {
			title: "Reset all Examiner data?",
			message: "All stored data for this plugin will be deleted permanently,",
			confirmText: "Delete everything",
			destructive: true,
		});
		if (!confirmed) return;
		this.resetting = true;
		try {
			await this.plugin.resetAllData();
		} finally {
			this.resetting = false;
		}
	}
}
