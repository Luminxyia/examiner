import type { ExamItem, ExamItemResult, ExamSummary } from "../core/exam";
import type { Judgement } from "../core/flashcard";
import type { StepResult } from "../core/generate";
import type { AttemptSummary } from "../core/statistics";
import type { StudySessionRecord } from "../core/study-time";

export const RESULTS_VERSION = 1;

export interface PracticeAttemptRecord {
	version: typeof RESULTS_VERSION;
	id: string;
	questionId: string;
	questionTitle: string;
	tags: string[];
	submittedAt: string;
	prompt: string;
	inputs: Record<string, number>;
	steps: StepResult[];
	answer: number;
	expectedDisplay: string;
	response: string;
	correct: boolean;
	kind?: "flashcard";
	outcome?: Judgement;
}

export interface ExamResultRecord {
	version: typeof RESULTS_VERSION;
	id: string;
	examId: string;
	examTitle: string;
	startedAt: string;
	submittedAt: string;
	timeLimitMinutes: number | null;
	timedOut: boolean;
	items: ExamItemResult[];
	summary: ExamSummary;
	activeMs?: number;
}

export interface ExamSession {
	version: typeof RESULTS_VERSION;
	attemptId?: string;
	examId: string;
	examTitle: string;
	startedAt: string;
	deadline: number | null;
	timeLimitMinutes: number | null;
	items: ExamItem[];
	responses: string[];
	dontKnow?: boolean[];
	current: number;
	marking?: ExamMarking;
	attachments?: string[];
}

export interface ExamMarking {
	submittedAt: string;
	timedOut: boolean;
	activeMs: number;
	judgements: (Judgement | null)[];
	current: number;
}

export interface DataFiles {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

export function isExamResultRecord(value: unknown): value is ExamResultRecord {
	if (!isObject(value) || !isObject(value.summary)) return false;
	const { summary } = value;
	return (
		typeof value.id === "string" &&
		typeof value.examId === "string" &&
		typeof value.examTitle === "string" &&
		isDate(value.submittedAt) &&
		Array.isArray(value.items) &&
		isFiniteNumber(summary.correct) &&
		isFiniteNumber(summary.total) &&
		isFiniteNumber(summary.percent) &&
		(summary.marks === undefined || isFiniteNumber(summary.marks)) &&
		(summary.maxMarks === undefined || isFiniteNumber(summary.maxMarks)) &&
		(value.activeMs === undefined || isFiniteNumber(value.activeMs))
	);
}

export function isStudySessionRecord(value: unknown): value is StudySessionRecord {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		(value.kind === "practice" || value.kind === "exam") &&
		isDate(value.startedAt) &&
		isDate(value.endedAt) &&
		isFiniteNumber(value.activeMs) &&
		value.activeMs >= 0
	);
}

export function toAttemptSummary(record: ExamResultRecord): AttemptSummary {
	return {
		id: record.id,
		examId: record.examId,
		examTitle: record.examTitle,
		submittedAt: record.submittedAt,
		correct: record.summary.correct,
		total: record.summary.total,
		marks: record.summary.marks ?? record.summary.correct,
		maxMarks: record.summary.maxMarks ?? record.summary.total,
		percent: record.summary.percent,
		...(record.activeMs === undefined ? {} : { activeMs: record.activeMs }),
	};
}

export class ResultsStore {
	private readonly listeners = new Set<() => void>();
	private examResults: Promise<ExamResultRecord[]> | null = null;
	private studySessions: Promise<StudySessionRecord[]> | null = null;
	private writes: Promise<void> = Promise.resolve();

	constructor(
		private readonly files: DataFiles,
		private readonly folder: string,
	) {}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	private get practicePath(): string {
		return `${this.folder}/practice-attempts.jsonl`;
	}

	private get examPath(): string {
		return `${this.folder}/exam-results.jsonl`;
	}

	private get studyPath(): string {
		return `${this.folder}/study-sessions.jsonl`;
	}

	private get sessionPath(): string {
		return `${this.folder}/exam-session.json`;
	}

	async recordPracticeAttempt(record: PracticeAttemptRecord): Promise<void> {
		await this.appendLine(this.practicePath, record);
		this.notify();
	}

	recordExamResult(record: ExamResultRecord): Promise<boolean> {
		return this.serially(async () => {
			const existing = await this.readExamResults();
			if (existing.some((result) => result.id === record.id)) return false;
			await this.appendLine(this.examPath, record);
			existing.push(record);
			this.notify();
			return true;
		});
	}

	recordStudySession(record: StudySessionRecord): Promise<void> {
		return this.serially(async () => {
			const existing = await this.readStudySessions();
			if (existing.some((session) => session.id === record.id)) return;
			await this.appendLine(this.studyPath, record);
			existing.push(record);
			this.notify();
		});
	}

	private serially<T>(task: () => Promise<T>): Promise<T> {
		const run = this.writes.then(task, task);
		this.writes = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	readPracticeAttempts(): Promise<PracticeAttemptRecord[]> {
		return this.readLines(this.practicePath, (value): value is PracticeAttemptRecord => isObject(value));
	}

	readExamResults(): Promise<ExamResultRecord[]> {
		this.examResults ??= this.readLines(this.examPath, isExamResultRecord).catch((error: unknown) => {
			this.examResults = null;
			throw error;
		});
		return this.examResults;
	}

	readStudySessions(): Promise<StudySessionRecord[]> {
		this.studySessions ??= this.readLines(this.studyPath, isStudySessionRecord).catch((error: unknown) => {
			this.studySessions = null;
			throw error;
		});
		return this.studySessions;
	}

	async saveSession(session: ExamSession): Promise<void> {
		await this.files.write(this.sessionPath, JSON.stringify(session));
		this.notify();
	}

	async clearSession(): Promise<void> {
		if (await this.files.exists(this.sessionPath)) await this.files.remove(this.sessionPath);
		this.notify();
	}

	clearAll(): Promise<void> {
		return this.serially(async () => {
			try {
				for (const path of [this.practicePath, this.examPath, this.studyPath, this.sessionPath]) {
					if (await this.files.exists(path)) await this.files.remove(path);
				}
			} finally {
				this.examResults = null;
				this.studySessions = null;
				this.notify();
			}
		});
	}

	async loadSession(): Promise<ExamSession | null> {
		if (!(await this.files.exists(this.sessionPath))) return null;
		try {
			const session = JSON.parse(await this.files.read(this.sessionPath)) as ExamSession;
			if (session.version !== RESULTS_VERSION || !Array.isArray(session.items) || !Array.isArray(session.responses)) {
				return null;
			}
			return session;
		} catch (error) {
			console.error("Examiner: could not read the saved exam session", error);
			return null;
		}
	}

	private async appendLine(path: string, record: object): Promise<void> {
		const line = `${JSON.stringify(record)}\n`;
		if (await this.files.exists(path)) await this.files.append(path, line);
		else await this.files.write(path, line);
	}

	private async readLines<T>(path: string, isValid: (value: unknown) => value is T): Promise<T[]> {
		if (!(await this.files.exists(path))) return [];
		const records: T[] = [];
		const lines = (await this.files.read(path)).split("\n");
		lines.forEach((line, index) => {
			if (line.trim() === "") return;
			try {
				const value: unknown = JSON.parse(line);
				if (isValid(value)) records.push(value);
				else console.warn(`Examiner: skipped an incomplete record on line ${index + 1} of ${path}`);
			} catch {
				console.warn(`Examiner: skipped unreadable line ${index + 1} in ${path}`);
			}
		});
		return records;
	}
}
