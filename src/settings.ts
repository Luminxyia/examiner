export interface ExaminerSettings {
	exampleCreated: boolean;
	vaultFilesImported: boolean;
}

export const DEFAULT_SETTINGS: ExaminerSettings = {
	exampleCreated: false,
	vaultFilesImported: false,
};
