export type LetterGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface GradeBoundaries {
	aPlus: number;
	a: number;
	b: number;
	c: number;
	d: number;
}

export interface GradeLine {
	letter: LetterGrade;
	percent: number;
}

export const DEFAULT_GRADE_BOUNDARIES: GradeBoundaries = {
	aPlus: 90,
	a: 70,
	b: 60,
	c: 50,
	d: 40,
};

export function letterGrade(percent: number, boundaries: GradeBoundaries): LetterGrade {
	if (percent >= boundaries.aPlus) return "A+";
	if (percent >= boundaries.a) return "A";
	if (percent >= boundaries.b) return "B";
	if (percent >= boundaries.c) return "C";
	if (percent >= boundaries.d) return "D";
	return "F";
}

export function gradeLines(boundaries: GradeBoundaries): GradeLine[] {
	return [
		{ letter: "A+", percent: boundaries.aPlus },
		{ letter: "A", percent: boundaries.a },
		{ letter: "B", percent: boundaries.b },
		{ letter: "C", percent: boundaries.c },
		{ letter: "D", percent: boundaries.d },
	];
}

export function gradeBoundaryIssue(boundaries: GradeBoundaries): string | null {
	const lines = gradeLines(boundaries);
	for (const line of lines) {
		const isWhole = Number.isInteger(line.percent);
		if (!isWhole || line.percent < 1 || line.percent > 100) {
			return `${line.letter} must be a whole number from 1 to 100.`;
		}
	}
	for (let index = 1; index < lines.length; index++) {
		const higher = lines[index - 1];
		const lower = lines[index];
		if (higher === undefined || lower === undefined) continue;
		if (lower.percent >= higher.percent) {
			return `${lower.letter} must be lower than ${higher.letter}.`;
		}
	}
	return null;
}
