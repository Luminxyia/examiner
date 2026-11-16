import { DEFAULT_GRADE_BOUNDARIES, type GradeBoundaries } from "./core/grades";

export interface ExaminerSettings {
	exampleCreated: boolean;
	reuseFolder: string;
	dataFolder: string;
	gradeAPlus: number;
	gradeA: number;
	gradeB: number;
	gradeC: number;
	gradeD: number;
}

export const DEFAULT_DATA_FOLDER = "examiner";

export const DEFAULT_SETTINGS: ExaminerSettings = {
	exampleCreated: false,
	reuseFolder: "",
	dataFolder: DEFAULT_DATA_FOLDER,
	gradeAPlus: DEFAULT_GRADE_BOUNDARIES.aPlus,
	gradeA: DEFAULT_GRADE_BOUNDARIES.a,
	gradeB: DEFAULT_GRADE_BOUNDARIES.b,
	gradeC: DEFAULT_GRADE_BOUNDARIES.c,
	gradeD: DEFAULT_GRADE_BOUNDARIES.d,
};

export function initialSettings(saved: Partial<ExaminerSettings> | null): ExaminerSettings {
	return { ...DEFAULT_SETTINGS, ...saved };
}

export function gradeBoundaries(settings: ExaminerSettings): GradeBoundaries {
	return {
		aPlus: settings.gradeAPlus,
		a: settings.gradeA,
		b: settings.gradeB,
		c: settings.gradeC,
		d: settings.gradeD,
	};
}
