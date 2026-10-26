import type { ExamItemResult } from "./exam";
import { describeChange, type AttemptSummary, type ExamGroup, type ScoreTrend } from "./statistics";

export interface InsightAttempt {
	id: string;
	examId: string;
	examTitle: string;
	submittedAt: string;
	items: readonly ExamItemResult[];
}

export type QuestionResult = "missed" | "partial" | "correct" | "skipped";

export interface MistakeEntry {
	questionId: string;
	title: string;
	examId: string;
	examTitle: string;
	tags: string[];
	missedAttempts: number;
	partialAttempts: number;
	seenAttempts: number;
	lastMissedAt: string;
	correctSinceLastMiss: boolean;
	priority: number;
	example: ExamItemResult;
}

export interface TopicMistakes {
	tag: string;
	questions: number;
	misses: number;
	priority: number;
}

export const MISTAKE_HALF_LIFE_DAYS = 30;

const DAY_MS = 86_400_000;

export function recencyWeight(at: string, now: Date, halfLifeDays = MISTAKE_HALF_LIFE_DAYS): number {
	const ageDays = Math.max(0, (now.getTime() - Date.parse(at)) / DAY_MS);
	return 0.5 ** (ageDays / halfLifeDays);
}

export function questionResults(attempt: InsightAttempt): Map<string, { result: QuestionResult; items: ExamItemResult[] }> {
	const byQuestion = new Map<string, ExamItemResult[]>();
	for (const item of attempt.items) {
		const list = byQuestion.get(item.questionId) ?? [];
		list.push(item);
		byQuestion.set(item.questionId, list);
	}
	const results = new Map<string, { result: QuestionResult; items: ExamItemResult[] }>();
	for (const [questionId, items] of byQuestion) {
		const has = (outcome: ExamItemResult["outcome"]) => items.some((item) => item.outcome === outcome);
		const result: QuestionResult = has("incorrect") ? "missed" : has("partial") ? "partial" : has("correct") ? "correct" : "skipped";
		results.set(questionId, { result, items });
	}
	return results;
}

function byTime(a: InsightAttempt, b: InsightAttempt): number {
	return Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id.localeCompare(b.id);
}

export function isRepeated(entry: Pick<MistakeEntry, "missedAttempts" | "partialAttempts">): boolean {
	return entry.missedAttempts + entry.partialAttempts >= 2;
}

export function aggregateMistakes(attempts: readonly InsightAttempt[], now: Date): MistakeEntry[] {
	const entries = new Map<string, MistakeEntry>();
	const seen = new Map<string, number>();
	for (const attempt of [...attempts].sort(byTime)) {
		for (const [questionId, { result, items }] of questionResults(attempt)) {
			seen.set(questionId, (seen.get(questionId) ?? 0) + 1);
			let entry = entries.get(questionId);
			if (result === "correct" && entry) entry.correctSinceLastMiss = true;
			if (result !== "missed" && result !== "partial") continue;
			const example = items.find((item) => item.outcome === (result === "missed" ? "incorrect" : "partial")) ?? items[0];
			if (!example) continue;
			if (!entry) {
				entry = {
					questionId,
					title: example.title,
					examId: attempt.examId,
					examTitle: attempt.examTitle,
					tags: [...example.tags],
					missedAttempts: 0,
					partialAttempts: 0,
					seenAttempts: 0,
					lastMissedAt: attempt.submittedAt,
					correctSinceLastMiss: false,
					priority: 0,
					example,
				};
				entries.set(questionId, entry);
			}
			if (result === "missed") entry.missedAttempts++;
			else entry.partialAttempts++;
			entry.priority += recencyWeight(attempt.submittedAt, now) * (result === "missed" ? 1 : 0.5);
			Object.assign(entry, {
				title: example.title,
				examId: attempt.examId,
				examTitle: attempt.examTitle,
				tags: [...example.tags],
				lastMissedAt: attempt.submittedAt,
				correctSinceLastMiss: false,
				example,
			});
		}
	}
	for (const entry of entries.values()) {
		entry.seenAttempts = seen.get(entry.questionId) ?? 0;
		if (isRepeated(entry)) entry.priority *= 1.5;

		if (entry.correctSinceLastMiss) entry.priority *= 0.5;
	}
	return [...entries.values()].sort(
		(a, b) => b.priority - a.priority || Date.parse(b.lastMissedAt) - Date.parse(a.lastMissedAt) || a.title.localeCompare(b.title),
	);
}

export function aggregateTopics(mistakes: readonly MistakeEntry[]): TopicMistakes[] {
	const topics = new Map<string, TopicMistakes>();
	for (const mistake of mistakes) {
		for (const tag of new Set(mistake.tags.map((value) => value.toLowerCase()))) {
			const label = mistake.tags.find((value) => value.toLowerCase() === tag) ?? tag;
			const topic = topics.get(tag) ?? { tag: label, questions: 0, misses: 0, priority: 0 };
			topic.questions++;
			topic.misses += mistake.missedAttempts + mistake.partialAttempts;
			topic.priority += mistake.priority;
			topics.set(tag, topic);
		}
	}
	return [...topics.values()].sort((a, b) => b.priority - a.priority || a.tag.localeCompare(b.tag));
}

export function describeMisses(entry: Pick<MistakeEntry, "missedAttempts" | "partialAttempts">): string {
	const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);
	const parts = [];
	if (entry.missedAttempts > 0) parts.push(`missed ${times(entry.missedAttempts)}`);
	if (entry.partialAttempts > 0) parts.push(`partly correct ${times(entry.partialAttempts)}`);
	return parts.join(", ");
}

export type PriorityStatus = "needs-attention" | "room-to-improve" | "performing-well" | "not-enough-evidence";

export type PriorityAction = "review-mistakes" | "practice-mistakes" | "retry-exam" | "gather-evidence";

export interface ExamPriority {
	examId: string;
	title: string;
	status: PriorityStatus;
	latest: AttemptSummary;
	previous: AttemptSummary | null;
	trend: ScoreTrend;
	attempts: number;
	questionsAnswered: number;
	reasons: string[];
	action: PriorityAction;
	mistakes: MistakeEntry[];
	recentScore: number;
}

export const MIN_ATTEMPTS_FOR_PRIORITY = 2;

export const MIN_QUESTIONS_FOR_PRIORITY = 5;

export const STRONG_SCORE = 80;

const STATUS_ORDER: Record<PriorityStatus, number> = {
	"needs-attention": 0,
	"room-to-improve": 1,
	"not-enough-evidence": 2,
	"performing-well": 3,
};

export function weightedRecentScore(attempts: readonly AttemptSummary[], now: Date): number {
	let total = 0;
	let weights = 0;
	for (const attempt of attempts) {
		const weight = recencyWeight(attempt.submittedAt, now);
		total += attempt.percent * weight;
		weights += weight;
	}
	return weights === 0 ? 0 : total / weights;
}

function isActive(mistake: MistakeEntry, now: Date): boolean {
	return !mistake.correctSinceLastMiss && recencyWeight(mistake.lastMissedAt, now) >= 0.5;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function studyPriorities(
	groups: readonly ExamGroup[],
	records: readonly InsightAttempt[],
	passingPercent: (examId: string) => number | null,
	now: Date,
): ExamPriority[] {
	const priorities = groups.map((group): ExamPriority => {
		const examRecords = records.filter((record) => record.examId === group.examId);
		const mistakes = aggregateMistakes(examRecords, now);
		const questionsAnswered = examRecords.reduce(
			(sum, record) => sum + record.items.filter((item) => item.outcome !== "unanswered" && item.outcome !== "unknown").length,
			0,
		);
		const passing = passingPercent(group.examId) ?? 50;
		const latest = group.latest;
		const recentScore = weightedRecentScore(group.attempts, now);
		const change = group.trend.kind === "change" ? group.trend.points : 0;
		const persistent = mistakes.filter((mistake) => isRepeated(mistake) && isActive(mistake, now));
		const reasons: string[] = [];

		let status: PriorityStatus;
		if (group.attempts.length < MIN_ATTEMPTS_FOR_PRIORITY || questionsAnswered < MIN_QUESTIONS_FOR_PRIORITY) {
			status = "not-enough-evidence";
			reasons.push(
				group.attempts.length < MIN_ATTEMPTS_FOR_PRIORITY
					? `Based on ${plural(group.attempts.length, "attempt")}`
					: `Only ${plural(questionsAnswered, "answer")} recorded`,
			);
		} else {
			const strong = Math.max(STRONG_SCORE, passing + 20);
			const belowPassing = latest.percent < passing && recentScore < passing;
			const sharpDecline = change <= -10 && latest.percent < strong;
			if (belowPassing || sharpDecline || persistent.length >= 2) status = "needs-attention";
			else if (latest.percent >= strong && (group.previous?.percent ?? 0) >= strong && persistent.length === 0) status = "performing-well";
			else status = "room-to-improve";

			if (group.trend.kind === "change" && Math.abs(change) >= 5) {
				reasons.push(`Recent score ${describeChange(group.trend, "increased", "decreased")}`);
			}
			if (latest.percent < passing) reasons.push(`Latest score is below the passing grade of ${passing}%`);
			const [worst] = persistent;
			if (worst) reasons.push(`"${worst.title || "Untitled question"}" missed in ${plural(worst.missedAttempts + worst.partialAttempts, "attempt")}`);
			if (persistent.length > 1) reasons.push(`${plural(persistent.length, "question")} missed more than once`);
			if (status === "performing-well") reasons.push(`At least ${strong}% in the last two attempts`);
		}

		const hasMistakes = mistakes.some((mistake) => !mistake.correctSinceLastMiss);
		const action: PriorityAction =
			status === "not-enough-evidence"
				? "gather-evidence"
				: status === "needs-attention"
					? hasMistakes
						? "review-mistakes"
						: "retry-exam"
					: status === "room-to-improve" && hasMistakes
						? "practice-mistakes"
						: "retry-exam";

		return {
			examId: group.examId,
			title: group.title,
			status,
			latest,
			previous: group.previous,
			trend: group.trend,
			attempts: group.attempts.length,
			questionsAnswered,
			reasons,
			action,
			mistakes,
			recentScore,
		};
	});
	return priorities.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.recentScore - b.recentScore || a.title.localeCompare(b.title));
}

export interface TargetCandidate {
	id: string;
	tags: readonly string[];
	title: string;
}

export interface TargetedSelection {
	questionIds: string[];
	fromMistakes: number;
	fromTopics: number;
	topics: string[];
}

export const TARGETED_EXAM_SIZE = 10;

export function selectTargetedQuestions(
	mistakes: readonly MistakeEntry[],
	candidates: readonly TargetCandidate[],
	size = TARGETED_EXAM_SIZE,
): TargetedSelection {
	const available = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const ranked = [...mistakes].sort((a, b) => Number(a.correctSinceLastMiss) - Number(b.correctSinceLastMiss) || b.priority - a.priority);
	const chosen = ranked.filter((mistake) => available.has(mistake.questionId)).slice(0, size);
	const questionIds = chosen.map((mistake) => mistake.questionId);
	const topics = aggregateTopics(chosen).map((topic) => topic.tag);
	const topicKeys = new Set(topics.map((topic) => topic.toLowerCase()));
	const related = candidates
		.filter((candidate) => !questionIds.includes(candidate.id))
		.map((candidate) => ({ candidate, shared: candidate.tags.filter((tag) => topicKeys.has(tag.toLowerCase())).length }))
		.filter((entry) => entry.shared > 0)
		.sort((a, b) => b.shared - a.shared || a.candidate.title.localeCompare(b.candidate.title))
		.slice(0, Math.max(0, size - questionIds.length))
		.map((entry) => entry.candidate.id);
	return { questionIds: [...questionIds, ...related], fromMistakes: questionIds.length, fromTopics: related.length, topics };
}

export type RecommendedAction = "review-mistakes" | "retry-exam" | "create-exam" | "open-exams" | "new-exam";

export interface Recommendation {
	heading: string;
	detail: string;
	actions: RecommendedAction[];
	examId: string | null;
	mistakes: MistakeEntry[];
}

const percentText = (value: number) => `${Math.round(value * 10) / 10}%`;

export function recommendNext(priorities: readonly ExamPriority[], mistakes: readonly MistakeEntry[], hasExams: boolean): Recommendation | null {
	if (priorities.length === 0) {
		return hasExams
			? { heading: "Take your first exam", detail: "Your results will show what to work on next.", actions: ["open-exams"], examId: null, mistakes: [] }
			: { heading: "Create your first exam", detail: "Combine your questions into an exam to start tracking results.", actions: ["new-exam"], examId: null, mistakes: [] };
	}

	const unresolved = mistakes.filter((mistake) => !mistake.correctSinceLastMiss);
	const repeated = unresolved.filter(isRepeated);
	const [top] = priorities;
	if (!top) return null;
	const topMistakes = top.mistakes.filter((mistake) => !mistake.correctSinceLastMiss);

	if (top.status === "needs-attention" && top.trend.kind === "change" && top.trend.points <= -5 && top.previous) {
		return {
			heading: `Ready to improve ${top.title || "this exam"}?`,
			detail: `Your latest score dropped from ${percentText(top.previous.percent)} to ${percentText(top.latest.percent)}. Review the questions you missed, then retry the exam.`,
			actions: topMistakes.length > 0 ? ["review-mistakes", "retry-exam"] : ["retry-exam"],
			examId: top.examId,
			mistakes: topMistakes,
		};
	}

	if (repeated.length > 0) {
		return {
			heading: "Revisit the questions you keep missing",
			detail: `${repeated.length === 1 ? "1 question was" : `${repeated.length} questions were`} answered incorrectly in more than one attempt.`,
			actions: ["review-mistakes", "create-exam"],
			examId: null,
			mistakes: repeated,
		};
	}

	if (top.status === "needs-attention") {
		return {
			heading: `Focus on ${top.title || "this exam"}`,
			detail: `${top.reasons[0] ?? "Recent results are below where they should be"}.`,
			actions: topMistakes.length > 0 ? ["review-mistakes", "retry-exam"] : ["retry-exam"],
			examId: top.examId,
			mistakes: topMistakes,
		};
	}

	if (unresolved.length > 0) {
		const improving = priorities.find((priority) => priority.trend.kind === "change" && priority.trend.points >= 5 && priority.status !== "not-enough-evidence");
		const count = unresolved.length === 1 ? "1 question" : `${unresolved.length} questions`;
		return improving && improving.trend.kind === "change"
			? {
					heading: "Keep the improvement going",
					detail: `Your latest score on ${improving.title || "an exam"} ${describeChange(improving.trend, "rose", "fell")}, but ${count} still ${unresolved.length === 1 ? "needs" : "need"} work.`,
					actions: ["create-exam"],
					examId: null,
					mistakes: unresolved,
				}
			: {
					heading: "Practice what you got wrong",
					detail: `${count} answered incorrectly ${unresolved.length === 1 ? "hasn't" : "haven't"} been answered correctly since.`,
					actions: ["create-exam", "review-mistakes"],
					examId: null,
					mistakes: unresolved,
				};
	}

	const thin = priorities.find((priority) => priority.status === "not-enough-evidence");
	if (thin) {
		return {
			heading: "Build up more practice data",
			detail: `${thin.title || "This exam"} has ${thin.attempts === 1 ? "only been attempted once" : "too few answers recorded"}, so it's too early to say how it's going.`,
			actions: ["retry-exam"],
			examId: thin.examId,
			mistakes: [],
		};
	}

	const stalest = [...priorities].sort((a, b) => Date.parse(a.latest.submittedAt) - Date.parse(b.latest.submittedAt))[0];
	if (!stalest) return null;
	return {
		heading: "Keep your results fresh",
		detail: `Your recent results on ${stalest.title || "this exam"} are strong. Retake it to check they hold.`,
		actions: ["retry-exam"],
		examId: stalest.examId,
		mistakes: [],
	};
}
