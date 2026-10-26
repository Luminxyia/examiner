import {
	ANSWER_VARIABLE,
	describeExpressionError,
	type FormulaStep,
	type QuestionDefinition,
	type VariableSource,
} from "./definition";
import { evaluate, ExpressionError, parseExpression } from "./expression";
import { formatFixed, formatNumber } from "./numbers";
import { renderTemplate } from "./template";

export type RandomSource = () => number;

export function randomInteger(min: number, max: number, random: RandomSource): number {
	return min + Math.floor(random() * (max - min + 1));
}

export function generateValue(source: VariableSource, random: RandomSource): number {
	switch (source.kind) {
		case "integer":
			return randomInteger(source.min, source.max, random);
		case "decimal": {
			const scale = 10 ** source.places;
			const units = randomInteger(Math.round(source.min * scale), Math.round(source.max * scale), random);
			return units / scale;
		}
		case "fixed":
			return source.value;
	}
}

export function formatVariableValue(source: VariableSource | undefined, value: number): string {
	if (source?.kind === "integer") return String(value);
	if (source?.kind === "decimal") return formatFixed(value, source.places);
	return formatNumber(value);
}

export interface StepResult {
	target: string;
	expression: string;
	value: number;
}

export class StepError extends Error {
	constructor(
		readonly stepIndex: number,
		readonly expressionError: ExpressionError,
		expression: string,
	) {
		super(`Step ${stepIndex + 1}: ${describeExpressionError(expressionError, expression)}`);
		this.name = "StepError";
	}
}

export function evaluateSteps(steps: readonly FormulaStep[], inputs: ReadonlyMap<string, number>): StepResult[] {
	const scope = new Map(inputs);
	return steps.map((step, index) => {
		try {
			const value = evaluate(parseExpression(step.expression), scope);
			scope.set(step.target, value);
			return { target: step.target, expression: step.expression, value };
		} catch (error) {
			if (error instanceof ExpressionError) throw new StepError(index, error, step.expression);
			throw error;
		}
	});
}

export interface QuestionInstance {
	questionId: string;
	inputs: Record<string, number>;
	steps: StepResult[];
	answer: number;
	prompt: string;
}

export class GenerationError extends Error {
	constructor(
		message: string,
		readonly lastError: StepError,
	) {
		super(message);
		this.name = "GenerationError";
	}
}

export const MAX_GENERATION_ATTEMPTS = 50;

export function generateInstance(definition: QuestionDefinition, random: RandomSource = Math.random): QuestionInstance {
	let lastError: StepError | undefined;
	for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
		const inputs = new Map(definition.variables.map((variable) => [variable.name, generateValue(variable.source, random)]));
		let steps: StepResult[];
		try {
			steps = evaluateSteps(definition.steps, inputs);
		} catch (error) {
			if (!(error instanceof StepError)) throw error;
			lastError = error;
			continue;
		}
		return {
			questionId: definition.id,
			inputs: Object.fromEntries(inputs),
			steps,
			answer: steps.find((step) => step.target === ANSWER_VARIABLE)?.value ?? Number.NaN,
			prompt: renderPrompt(definition, inputs, steps),
		};
	}
	throw new GenerationError(
		`Could not generate a usable question after ${MAX_GENERATION_ATTEMPTS} attempts. ${lastError?.message ?? ""}`.trim(),
		lastError as StepError,
	);
}

export function renderPrompt(
	definition: QuestionDefinition,
	inputs: ReadonlyMap<string, number>,
	steps: readonly StepResult[],
): string {
	const sources = new Map(definition.variables.map((variable) => [variable.name, variable.source]));
	const display = new Map<string, string>();
	for (const [name, value] of inputs) display.set(name, formatVariableValue(sources.get(name), value));
	for (const step of steps) {
		if (step.target !== ANSWER_VARIABLE) display.set(step.target, formatNumber(step.value));
	}
	return renderTemplate(definition.prompt, display);
}

export function probeDefinition(
	definition: QuestionDefinition,
	random: RandomSource = Math.random,
	samples = 200,
): { failureRate: number; example: StepError } | null {
	let failures = 0;
	let example: StepError | undefined;
	for (let i = 0; i < samples; i++) {
		const inputs = new Map(definition.variables.map((variable) => [variable.name, generateValue(variable.source, random)]));
		try {
			evaluateSteps(definition.steps, inputs);
		} catch (error) {
			if (!(error instanceof StepError)) throw error;
			failures++;
			example ??= error;
		}
	}
	return example ? { failureRate: failures / samples, example } : null;
}

export function workedSteps(instance: Pick<QuestionInstance, "inputs" | "steps">): string[] {
	const values = new Map<string, string>();
	const show = (value: number) => (value < 0 ? `(${formatNumber(value)})` : formatNumber(value));
	for (const [name, value] of Object.entries(instance.inputs)) values.set(name, show(value));
	return instance.steps.map((step) => {
		const substituted = renderTemplate(step.expression, values);
		values.set(step.target, show(step.value));
		const parts = [`{${step.target}}`, step.expression];
		if (substituted !== step.expression) parts.push(substituted);
		if (substituted !== formatNumber(step.value)) parts.push(formatNumber(step.value));
		return parts.join(" = ");
	});
}
