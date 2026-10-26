import type { FlashcardMode, QuestionDefinition } from "./definition";
import type { RandomSource } from "./generate";
import { shuffled } from "./random";

export type Judgement = "correct" | "partial" | "incorrect";

export interface FlashcardCard {
	prompt: string;
	mode: FlashcardMode;
	answer: string;
	options: string[];
	correct: number;
}

export function drawFlashcard(definition: QuestionDefinition, random: RandomSource = Math.random): FlashcardCard {
	const { flashcard } = definition;
	const card = { prompt: definition.prompt, mode: flashcard.mode, answer: flashcard.answer, options: [] as string[], correct: 0 };
	if (flashcard.mode !== "choice") return card;
	const order = shuffled(
		flashcard.options.map((_option, index) => index),
		random,
	);
	card.options = order.map((index) => flashcard.options[index] ?? "");
	card.correct = order.indexOf(flashcard.correct);
	return card;
}

export function expectedFlashcardAnswer(card: Pick<FlashcardCard, "mode" | "answer" | "options" | "correct">): string {
	return card.mode === "choice" ? (card.options[card.correct] ?? "") : card.answer;
}

export function chosenOption(response: string | undefined, optionCount: number): number | null {
	if (response === undefined || !/^\d+$/.test(response.trim())) return null;
	const index = Number(response);
	return index < optionCount ? index : null;
}

export function awardedMarks(judgement: Judgement, marks: number): number {
	if (judgement === "correct") return marks;
	return judgement === "partial" ? marks / 2 : 0;
}
