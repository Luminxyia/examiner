import { describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../src/core/definition";
import {
	evaluateSteps,
	GenerationError,
	generateInstance,
	generateValue,
	MAX_GENERATION_ATTEMPTS,
	probeDefinition,
	randomInteger,
	StepError,
	workedSteps,
} from "../src/core/generate";
import { hasAtMostPlaces } from "../src/core/numbers";
import { basicAddition, seededRandom, sequence } from "./helpers";

describe("random integers", () => {
	it("includes both ends of the range", () => {
		expect(randomInteger(1, 20, () => 0)).toBe(1);
		expect(randomInteger(1, 20, () => 0.999999999)).toBe(20);
		expect(randomInteger(-5, -5, () => 0.7)).toBe(-5);
	});

	it("produces every value in a small range and nothing outside it", () => {
		const random = seededRandom(1);
		const seen = new Set<number>();
		for (let i = 0; i < 2000; i++) {
			const value = randomInteger(-2, 3, random);
			expect(Number.isInteger(value)).toBe(true);
			seen.add(value);
		}
		expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
	});
});

describe("random decimals", () => {
	const source = { kind: "decimal", min: 0.1, max: 0.3, places: 1 } as const;

	it("includes both ends and respects precision", () => {
		expect(generateValue(source, () => 0)).toBe(0.1);
		expect(generateValue(source, () => 0.9999999)).toBe(0.3);
		const random = seededRandom(2);
		const seen = new Set<number>();
		for (let i = 0; i < 500; i++) seen.add(generateValue(source, random));
		expect([...seen].sort()).toEqual([0.1, 0.2, 0.3]);
	});

	it("never produces more decimal places than configured", () => {
		const random = seededRandom(3);
		for (let i = 0; i < 1000; i++) {
			const value = generateValue({ kind: "decimal", min: -2.5, max: 7.25, places: 2 }, random);
			expect(value).toBeGreaterThanOrEqual(-2.5);
			expect(value).toBeLessThanOrEqual(7.25);
			expect(hasAtMostPlaces(value, 2)).toBe(true);
			expect(String(value)).toMatch(/^-?\d+(\.\d{1,2})?$/);
		}
	});
});

describe("fixed values", () => {
	it("always returns the configured value", () => {
		expect(generateValue({ kind: "fixed", value: 9.81 }, seededRandom(4))).toBe(9.81);
	});
});

describe("formula steps", () => {
	it("evaluates in order and passes intermediate results forward", () => {
		const steps = [
			{ target: "z", expression: "{x} + {y}" },
			{ target: "answer", expression: "sqrt({z}^2 + {z}^2)" },
		];
		const results = evaluateSteps(steps, new Map([["x", 5], ["y", 4]]));
		expect(results.map((step) => step.target)).toEqual(["z", "answer"]);
		expect(results[0]?.value).toBe(9);
		expect(results[1]?.value).toBeCloseTo(12.7279220614, 9);
	});

	it("reports which step failed", () => {
		const steps = [
			{ target: "z", expression: "{x} - {y}" },
			{ target: "answer", expression: "{x} / {z}" },
		];
		try {
			evaluateSteps(steps, new Map([["x", 3], ["y", 3]]));
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(StepError);
			expect((error as StepError).stepIndex).toBe(1);
			expect((error as StepError).message).toContain("Step 2: Division by zero");
		}
	});
});

describe("question instances", () => {
	it("renders the prompt with the generated values", () => {
		const instance = generateInstance(basicAddition(), sequence(0.6, 0.15));
		expect(instance.inputs).toEqual({ x: 7, y: 2 });
		expect(instance.prompt).toBe("What is 7 + 2?");
		expect(instance.answer).toBe(9);
	});

	it("uses the same value for every occurrence of a variable", () => {
		const definition = basicAddition({ prompt: "{x} plus {y}. Remember, {x} comes first, then {y}." });
		const instance = generateInstance(definition, seededRandom(5));
		const { x, y } = instance.inputs;
		expect(instance.prompt).toBe(`${x} plus ${y}. Remember, ${x} comes first, then ${y}.`);
	});

	it("generates independent values for each variable and each instance", () => {
		const definition = basicAddition({
			variables: [
				{ name: "x", source: { kind: "integer", min: 1, max: 1000 } },
				{ name: "y", source: { kind: "integer", min: 1, max: 1000 } },
			],
		});
		const random = seededRandom(6);
		const instances = Array.from({ length: 20 }, () => generateInstance(definition, random));
		expect(new Set(instances.map((instance) => instance.prompt)).size).toBeGreaterThan(15);
		expect(instances.some((instance) => instance.inputs.x !== instance.inputs.y)).toBe(true);
		for (const instance of instances) {
			expect(instance.answer).toBe((instance.inputs.x ?? 0) + (instance.inputs.y ?? 0));
		}
	});

	it("does not modify the definition", () => {
		const definition = basicAddition();
		const before = structuredClone(definition);
		generateInstance(definition, seededRandom(7));
		expect(definition).toEqual(before);
	});

	it("formats inputs by type and intermediates without noise", () => {
		const definition: QuestionDefinition = {
			...basicAddition(),
			prompt: "a={a}, b={b}, g={g}, s={s}",
			variables: [
				{ name: "a", source: { kind: "integer", min: 3, max: 3 } },
				{ name: "b", source: { kind: "decimal", min: 0.5, max: 0.5, places: 2 } },
				{ name: "g", source: { kind: "fixed", value: 9.81 } },
			],
			steps: [
				{ target: "s", expression: "0.1 + 0.2" },
				{ target: "answer", expression: "{a} * {b} * {g} + {s}" },
			],
		};
		expect(generateInstance(definition, seededRandom(8)).prompt).toBe("a=3, b=0.50, g=9.81, s=0.3");
	});

	it("keeps braces when substituting inside LaTeX", () => {
		const definition = basicAddition({ prompt: "Find $\\sqrt{x} + \\frac{y}{2}$ for $x = {x}$." });
		const instance = generateInstance(definition, sequence(0.95, 0.35));
		expect(instance.prompt).toBe("Find $\\sqrt{10} + \\frac{4}{2}$ for $x = {10}$.");
	});

	it("redraws values that make a step fail", () => {
		const definition = basicAddition({
			variables: [
				{ name: "x", source: { kind: "integer", min: 1, max: 5 } },
				{ name: "y", source: { kind: "integer", min: 0, max: 1 } },
			],
			steps: [{ target: "answer", expression: "{x} / {y}" }],
		});
		const instance = generateInstance(definition, sequence(0.5, 0.1, 0.5, 0.9));
		expect(instance.inputs.y).toBe(1);
		expect(instance.answer).toBe(3);
	});

	it("gives up with a useful error when no values work", () => {
		const definition = basicAddition({ steps: [{ target: "answer", expression: "{x} / ({y} - {y})" }] });
		expect(() => generateInstance(definition, seededRandom(9))).toThrow(GenerationError);
		expect(() => generateInstance(definition, seededRandom(9))).toThrow(
			`after ${MAX_GENERATION_ATTEMPTS} attempts. Step 1: Division by zero`,
		);
	});
});

describe("probing", () => {
	it("finds steps that fail for some values", () => {
		const definition = basicAddition({
			variables: [
				{ name: "x", source: { kind: "integer", min: 1, max: 5 } },
				{ name: "y", source: { kind: "integer", min: 0, max: 3 } },
			],
			steps: [{ target: "answer", expression: "{x} / {y}" }],
		});
		const result = probeDefinition(definition, seededRandom(10));
		expect(result?.failureRate).toBeGreaterThan(0.1);
		expect(result?.failureRate).toBeLessThan(0.4);
		expect(result?.example.message).toContain("Division by zero");
	});

	it("returns null when every sample works", () => {
		expect(probeDefinition(basicAddition(), seededRandom(11))).toBeNull();
	});
});

describe("worked steps", () => {
	it("substitutes values into each step", () => {
		const steps = [
			{ target: "z", expression: "{x} - {y}" },
			{ target: "answer", expression: "{z} * 2" },
		];
		const inputs = { x: 2, y: 5 };
		const instance = { inputs, steps: evaluateSteps(steps, new Map(Object.entries(inputs))) };
		expect(workedSteps(instance)).toEqual(["{z} = {x} - {y} = 2 - 5 = -3", "{answer} = {z} * 2 = (-3) * 2 = -6"]);
	});

	it("skips repetition for constant steps", () => {
		const instance = { inputs: {}, steps: evaluateSteps([{ target: "answer", expression: "4" }], new Map()) };
		expect(workedSteps(instance)).toEqual(["{answer} = 4"]);
	});
});
