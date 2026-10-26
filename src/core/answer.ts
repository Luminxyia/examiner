import type { AnswerRule } from "./definition";
import { formatFixed, formatNumber, formatScientific, roundToPlaces } from "./numbers";

const EXACT_RELATIVE_TOLERANCE = 1e-9;

export function expectedAnswer(rule: AnswerRule, answer: number): number {
	return rule.check === "rounded" ? roundToPlaces(answer, rule.places) : answer;
}

export function formatExpectedAnswer(rule: AnswerRule, answer: number, scientific = false): string {
	if (scientific) return formatScientific(expectedAnswer(rule, answer));
	return rule.check === "rounded" ? formatFixed(answer, rule.places) : formatNumber(answer);
}

export function answerInstruction(rule: AnswerRule): string | null {
	if (rule.check !== "rounded") return null;
	if (rule.places === 0) return "Round your answer to the nearest whole number.";
	return `Round your answer to ${rule.places} decimal place${rule.places === 1 ? "" : "s"}.`;
}

export interface AnswerCheck {
	correct: boolean;
	hint?: string;
}

export function checkAnswer(rule: AnswerRule, answer: number, response: number): AnswerCheck {
	switch (rule.check) {
		case "exact":
			return { correct: withinTolerance(response, answer, EXACT_RELATIVE_TOLERANCE * Math.max(1, Math.abs(answer))) };
		case "rounded": {
			const expected = roundToPlaces(answer, rule.places);
			if (response === expected) return { correct: true };
			if (roundToPlaces(response, rule.places) === expected) {
				const placesText = rule.places === 0 ? "the nearest whole number" : `${rule.places} decimal place${rule.places === 1 ? "" : "s"}`;
				return { correct: false, hint: `The value is right, but it needs rounding to ${placesText}.` };
			}
			return { correct: false };
		}
		case "absolute":
			return { correct: withinTolerance(response, answer, rule.tolerance) };
		case "relative":
			return { correct: withinTolerance(response, answer, (rule.percent / 100) * Math.abs(answer)) };
	}
}

function withinTolerance(response: number, answer: number, tolerance: number): boolean {

	const margin = 1e-12 * Math.max(1, Math.abs(answer));
	return Math.abs(response - answer) <= tolerance + margin;
}
