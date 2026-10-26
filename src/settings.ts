export interface ExaminerSettings {
	exampleCreated: boolean;
	vaultFilesImported: boolean;
	reuseFolder: string;
}

export const DEFAULT_SETTINGS: ExaminerSettings = {
	exampleCreated: false,
	vaultFilesImported: false,
	reuseFolder: "",
};

export function initialSettings(saved: Partial<ExaminerSettings> | null): ExaminerSettings {
	return { ...DEFAULT_SETTINGS, ...(saved === null ? { vaultFilesImported: true } : saved) };
}
