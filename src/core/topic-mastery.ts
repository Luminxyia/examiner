import type { PrepAttempt } from "./exam-prep";

export interface MasteryQuestion {
	questionId: string;
	tags: readonly string[];
}

export interface TopicMastery {
	tag: string;
	percent: number;
}

export const INITIAL_MASTERY = 0.3;

export const MASTERY_SLIP = 0.1;

export const MASTERY_GUESS = 0.2;

export const MASTERY_LEARN = 0.15;

export const UNTAGGED_TOPIC = "Untagged";

export function updateMastery(mastery: number, correct: boolean): number {
	let afterAnswer: number;
	if (correct) {
		const knewIt = mastery * (1 - MASTERY_SLIP);
		const guessedIt = (1 - mastery) * MASTERY_GUESS;
		afterAnswer = knewIt / (knewIt + guessedIt);
	} else {
		const slipped = mastery * MASTERY_SLIP;
		const didNotKnow = (1 - mastery) * (1 - MASTERY_GUESS);
		afterAnswer = slipped / (slipped + didNotKnow);
	}
	return afterAnswer + (1 - afterAnswer) * MASTERY_LEARN;
}

interface TopicProgress {
	tag: string;
	mastery: number;
}

function topicKeysOf(tags: readonly string[]): string[] {
	if (tags.length === 0) return [UNTAGGED_TOPIC.toLowerCase()];
	return [...new Set(tags.map((tag) => tag.toLowerCase()))];
}

function labelFor(key: string, tags: readonly string[]): string {
	if (key === UNTAGGED_TOPIC.toLowerCase()) return UNTAGGED_TOPIC;
	const label = tags.find((tag) => tag.toLowerCase() === key);
	return label ?? key;
}

export function topicMastery(questions: readonly MasteryQuestion[], attempts: readonly PrepAttempt[]): TopicMastery[] {
	const topics = new Map<string, TopicProgress>();
	const keysByQuestion = new Map<string, string[]>();

	for (const question of questions) {
		const keys = topicKeysOf(question.tags);
		keysByQuestion.set(question.questionId, keys);
		for (const key of keys) {
			if (!topics.has(key)) topics.set(key, { tag: labelFor(key, question.tags), mastery: INITIAL_MASTERY });
		}
	}

	for (const attempt of attempts) {
		const keys = keysByQuestion.get(attempt.questionId);
		if (!keys) continue;
		for (const key of keys) {
			const topic = topics.get(key);
			if (topic) topic.mastery = updateMastery(topic.mastery, attempt.correct);
		}
	}

	const results = [...topics.values()].map((topic) => ({ tag: topic.tag, percent: Math.round(topic.mastery * 100) }));
	results.sort((a, b) => b.percent - a.percent || a.tag.localeCompare(b.tag));
	return results;
}
