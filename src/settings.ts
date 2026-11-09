export interface ExaminerSettings {
	exampleCreated: boolean;
	reuseFolder: string;
	dataFolder: string;
}

export const DEFAULT_DATA_FOLDER = "examiner";

export const DEFAULT_SETTINGS: ExaminerSettings = {
	exampleCreated: false,
	reuseFolder: "",
	dataFolder: DEFAULT_DATA_FOLDER,
};

export function initialSettings(saved: Partial<ExaminerSettings> | null): ExaminerSettings {
	return { ...DEFAULT_SETTINGS, ...saved };
}
