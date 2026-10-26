export const IDLE_LIMIT_MS = 5 * 60_000;

export const MIN_SESSION_MS = 5_000;

export type StudyKind = "practice" | "exam";

export interface StudyContext {
	kind: StudyKind;
	key: string;
	questionId?: string;
	examId?: string;
	attemptId?: string;
}

export interface StudySessionRecord {
	version: 1;
	id: string;
	kind: StudyKind;
	startedAt: string;
	endedAt: string;
	activeMs: number;
	questionId?: string;
	examId?: string;
	attemptId?: string;
}

export class StudyTracker {
	private context: StudyContext | null = null;
	private engaged = false;
	private runningSince: number | null = null;
	private lastActivity = Number.NEGATIVE_INFINITY;
	private activeMs = 0;
	private firstStart: number | null = null;
	private lastStop: number | null = null;

	constructor(
		private readonly now: () => number,
		private readonly createId: () => string,
		private readonly onSession: (record: StudySessionRecord) => void,
	) {}

	setContext(context: StudyContext | null): void {
		if (context?.key === this.context?.key) return;
		this.finish();
		this.context = context;
		if (context) this.lastActivity = this.now();
		this.update();
	}

	setEngaged(engaged: boolean): void {
		if (engaged === this.engaged) return;
		this.engaged = engaged;
		if (engaged) this.lastActivity = this.now();
		this.update();
	}

	activity(): void {
		const now = this.now();
		if (this.runningSince !== null && now - this.lastActivity > IDLE_LIMIT_MS) this.stop();
		this.lastActivity = now;
		this.update();
	}

	endIf(key: string): void {
		if (this.context?.key === key) this.setContext(null);
	}

	finish(): void {
		this.stop();
		const context = this.context;
		if (context && this.firstStart !== null && this.lastStop !== null && this.activeMs >= MIN_SESSION_MS) {
			this.onSession({
				version: 1,
				id: this.createId(),
				kind: context.kind,
				startedAt: new Date(this.firstStart).toISOString(),
				endedAt: new Date(this.lastStop).toISOString(),
				activeMs: Math.round(this.activeMs),
				...(context.questionId === undefined ? {} : { questionId: context.questionId }),
				...(context.examId === undefined ? {} : { examId: context.examId }),
				...(context.attemptId === undefined ? {} : { attemptId: context.attemptId }),
			});
		}
		this.activeMs = 0;
		this.firstStart = null;
		this.lastStop = null;
	}

	discard(): void {
		this.runningSince = null;
		this.activeMs = 0;
		this.firstStart = null;
		this.lastStop = null;
		this.update();
	}

	currentActiveMs(): number {
		if (this.runningSince === null) return this.activeMs;
		return this.activeMs + Math.max(0, this.countedUntil(this.now()) - this.runningSince);
	}

	private update(): void {
		const shouldRun = this.context !== null && this.engaged;
		if (shouldRun && this.runningSince === null) {
			const now = this.now();
			this.runningSince = now;
			this.firstStart ??= now;
		} else if (!shouldRun) {
			this.stop();
		}
	}

	private stop(): void {
		if (this.runningSince === null) return;
		const end = this.countedUntil(this.now());
		this.activeMs += Math.max(0, end - this.runningSince);
		this.lastStop = Math.max(end, this.runningSince);
		this.runningSince = null;
	}

	private countedUntil(now: number): number {
		return Math.max(this.runningSince ?? now, Math.min(now, this.lastActivity + IDLE_LIMIT_MS));
	}
}
