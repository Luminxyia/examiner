import type { StudySessionRecord } from "./study-time";

export interface AttemptSummary {
	id: string;
	examId: string;
	examTitle: string;
	submittedAt: string;
	correct: number;
	total: number;
	marks: number;
	maxMarks: number;
	percent: number;
	activeMs?: number;
}

export interface NumberedAttempt extends AttemptSummary {
	attemptNumber: number;
}

export interface StudyOverview {
	totalStudyMs: number;
	todayMs: number;
	yesterdayMs: number;
	daily: Map<string, number>;
	recent: NumberedAttempt[];
}

export interface AttemptedExam {
	examId: string;
	title: string;
	lastSubmittedAt: string;
}

export type DayComparison =
	| { kind: "up" | "down"; percent: number }
	| { kind: "same" }
	| { kind: "no-baseline" };

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${totalSeconds}s`;
}

function byCompletion(a: AttemptSummary, b: AttemptSummary): number {
	return Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id.localeCompare(b.id);
}

export function numberAttempts(attempts: readonly AttemptSummary[]): NumberedAttempt[] {
	const counts = new Map<string, number>();
	return [...attempts].sort(byCompletion).map((attempt) => {
		const attemptNumber = (counts.get(attempt.examId) ?? 0) + 1;
		counts.set(attempt.examId, attemptNumber);
		return { ...attempt, attemptNumber };
	});
}

export function examHistory(attempts: readonly AttemptSummary[], examId: string): NumberedAttempt[] {
	return numberAttempts(attempts.filter((attempt) => attempt.examId === examId));
}

export function attemptedExams(attempts: readonly AttemptSummary[]): AttemptedExam[] {
	const latest = new Map<string, AttemptSummary>();
	for (const attempt of [...attempts].sort(byCompletion)) latest.set(attempt.examId, attempt);
	return [...latest.values()]
		.reverse()
		.map((attempt) => ({ examId: attempt.examId, title: attempt.examTitle, lastSubmittedAt: attempt.submittedAt }));
}

export function localDayKey(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dailyStudyTotals(sessions: readonly StudySessionRecord[]): Map<string, number> {
	const totals = new Map<string, number>();
	const add = (day: Date, ms: number) => {
		if (ms <= 0) return;
		const key = localDayKey(day);
		totals.set(key, (totals.get(key) ?? 0) + ms);
	};
	for (const session of sessions) {
		const start = Date.parse(session.startedAt);
		const end = Date.parse(session.endedAt);
		const span = end - start;
		if (!(span > 0)) {
			add(new Date(start), session.activeMs);
			continue;
		}
		let dayStart = startOfLocalDay(new Date(start));
		while (dayStart.getTime() < end) {
			const nextDay = addLocalDays(dayStart, 1);
			const overlap = Math.min(end, nextDay.getTime()) - Math.max(start, dayStart.getTime());
			add(dayStart, (overlap / span) * session.activeMs);
			dayStart = nextDay;
		}
	}
	return totals;
}

export function compareWithYesterday(todayMs: number, yesterdayMs: number): DayComparison {
	if (yesterdayMs <= 0) return { kind: "no-baseline" };
	const percent = Math.round(((todayMs - yesterdayMs) / yesterdayMs) * 100);
	if (percent === 0) return { kind: "same" };
	return { kind: percent > 0 ? "up" : "down", percent: Math.abs(percent) };
}

export function summariseStudy(
	sessions: readonly StudySessionRecord[],
	attempts: readonly AttemptSummary[],
	now: Date,
	recentLimit = 8,
): StudyOverview {
	const daily = dailyStudyTotals(sessions);
	const today = startOfLocalDay(now);
	return {
		totalStudyMs: sessions.reduce((sum, session) => sum + session.activeMs, 0),
		todayMs: daily.get(localDayKey(today)) ?? 0,
		yesterdayMs: daily.get(localDayKey(addLocalDays(today, -1))) ?? 0,
		daily,
		recent: numberAttempts(attempts).reverse().slice(0, recentLimit),
	};
}

export type ScoreTrend = { kind: "change"; points: number; relative: number | null } | { kind: "none"; reason: "single-attempt" | "not-comparable" };

export function relativeChange(latest: number, previous: number): number | null {
	if (!(previous > 0)) return null;
	return Math.round(((latest - previous) / previous) * 100);
}

export function formatSignedPercent(value: number): string {
	return `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value)}%`;
}

export function describeChange(trend: Extract<ScoreTrend, { kind: "change" }>, rose: string, fell: string): string {
	const verb = trend.points >= 0 ? rose : fell;
	return `${verb} (${formatSignedPercent(trend.relative ?? Math.round(trend.points))})`;
}

export interface ExamGroup {
	examId: string;
	title: string;
	attempts: NumberedAttempt[];
	latest: NumberedAttempt;
	previous: NumberedAttempt | null;
	trend: ScoreTrend;
}

export type HistoryFilter = "all" | "lowest" | "recent";

export function scoreTrend(latest: AttemptSummary, previous: AttemptSummary | null): ScoreTrend {
	if (!previous) return { kind: "none", reason: "single-attempt" };
	if (previous.maxMarks !== latest.maxMarks || previous.total !== latest.total) return { kind: "none", reason: "not-comparable" };
	return {
		kind: "change",
		points: Math.round((latest.percent - previous.percent) * 10) / 10,
		relative: relativeChange(latest.percent, previous.percent),
	};

}

export function groupAttemptsByExam(attempts: readonly AttemptSummary[], currentTitle: (examId: string) => string | undefined = () => undefined): ExamGroup[] {
	const byExam = new Map<string, NumberedAttempt[]>();
	for (const attempt of numberAttempts(attempts)) {
		const list = byExam.get(attempt.examId) ?? [];
		list.push(attempt);
		byExam.set(attempt.examId, list);
	}
	const groups: ExamGroup[] = [];
	for (const [examId, history] of byExam) {
		const newestFirst = [...history].reverse();
		const latest = newestFirst[0];
		if (!latest) continue;
		const previous = newestFirst[1] ?? null;
		groups.push({
			examId,
			title: currentTitle(examId) ?? latest.examTitle,
			attempts: newestFirst,
			latest,
			previous,
			trend: scoreTrend(latest, previous),
		});
	}
	return filterExamGroups(groups, "recent");
}

export function filterExamGroups(groups: readonly ExamGroup[], filter: HistoryFilter): ExamGroup[] {
	const recency = (a: ExamGroup, b: ExamGroup) => byCompletion(b.latest, a.latest);
	const sorted = [...groups];
	if (filter === "all") return sorted.sort((a, b) => a.title.localeCompare(b.title) || a.examId.localeCompare(b.examId));
	if (filter === "lowest") return sorted.sort((a, b) => a.latest.percent - b.latest.percent || recency(a, b));
	return sorted.sort(recency);
}
