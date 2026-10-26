import { PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type ExaminerPlugin from "../main";
import { confirm } from "./shared";

export class ExaminerSettingTab extends PluginSettingTab {
	private resetting = false;

	constructor(private readonly plugin: ExaminerPlugin) {
		super(plugin.app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
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
		];
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
