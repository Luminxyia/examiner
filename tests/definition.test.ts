import { describe, expect, it } from "vitest";
import { hasErrors, validateDefinition, type QuestionDefinition, type ValidationIssue } from "../src/core/definition";
import { basicAddition } from "./helpers";

function errorsOf(definition: QuestionDefinition): ValidationIssue[] {
	return validateDefinition(definition).filter((issue) => issue.severity === "error");
}

function messagesAt(definition: QuestionDefinition, path: string): string[] {
	return validateDefinition(definition)
		.filter((issue) => issue.path === path)
		.map((issue) => issue.message);
}

describe("validateDefinition", () => {
	it("accepts the basic addition example", () => {
		expect(validateDefinition(basicAddition())).toEqual([]);
	});

	it("accepts the multi-step example", () => {
		const definition = basicAddition({
			prompt: "Sides of {x} and {y}.",
			steps: [
				{ target: "z", expression: "{x} + {y}" },
				{ target: "answer", expression: "sqrt({z}^2 + {z}^2)" },
			],
			answer: { check: "rounded", places: 2 },
		});
		expect(validateDefinition(definition)).toEqual([]);
	});

	it("requires a title and prompt", () => {
		const definition = basicAddition({ title: "  ", prompt: "" });
		expect(messagesAt(definition, "title")).toEqual(["Give the question a title."]);
		expect(messagesAt(definition, "prompt")).toContain("Write the question.");
	});

	describe("variable names", () => {
		it.each([
			["", "Enter a variable name."],
			["2x", "Use letters, digits and underscores"],
			["x y", "Use letters, digits and underscores"],
			["answer", "{answer} is reserved"],
		])("rejects %j", (name, message) => {
			const definition = basicAddition({
				variables: [{ name, source: { kind: "fixed", value: 1 } }, ...basicAddition().variables],
			});
			expect(messagesAt(definition, "variables.0.name").join(" ")).toContain(message);
		});

		it("rejects duplicates", () => {
			const definition = basicAddition({
				variables: [
					{ name: "x", source: { kind: "integer", min: 1, max: 2 } },
					{ name: "x", source: { kind: "integer", min: 1, max: 2 } },
					{ name: "y", source: { kind: "integer", min: 1, max: 2 } },
				],
			});
			expect(messagesAt(definition, "variables.1.name")).toEqual(["{x} is already defined."]);
		});
	});

	describe("ranges", () => {
		it("rejects an inverted integer range", () => {
			const definition = basicAddition({
				variables: [
					{ name: "x", source: { kind: "integer", min: 10, max: 1 } },
					{ name: "y", source: { kind: "integer", min: 1, max: 10 } },
				],
			});
			expect(messagesAt(definition, "variables.0.max")).toEqual(["The maximum must not be less than the minimum."]);
		});

		it("rejects non-integer bounds for integers", () => {
			const definition = basicAddition({
				variables: [
					{ name: "x", source: { kind: "integer", min: 1.5, max: Number.NaN } },
					{ name: "y", source: { kind: "integer", min: 1, max: 10 } },
				],
			});
			expect(messagesAt(definition, "variables.0.min")).toEqual(["The minimum must be a whole number."]);
			expect(messagesAt(definition, "variables.0.max")).toEqual(["The maximum must be a whole number."]);
		});

		it("checks decimal places and bounds", () => {
			const variables = (min: number, max: number, places: number) => [
				{ name: "x", source: { kind: "decimal" as const, min, max, places } },
				{ name: "y", source: { kind: "integer" as const, min: 1, max: 10 } },
			];
			expect(messagesAt(basicAddition({ variables: variables(0, 1, 0) }), "variables.0.places")[0]).toContain("from 1 to 10");
			expect(messagesAt(basicAddition({ variables: variables(0, 1, 11) }), "variables.0.places")[0]).toContain("from 1 to 10");
			expect(messagesAt(basicAddition({ variables: variables(0.125, 1, 2) }), "variables.0.min")).toEqual([
				"The minimum has more than 2 decimal places.",
			]);
			expect(errorsOf(basicAddition({ variables: variables(0.1, 0.3, 1) }))).toEqual([]);
		});

		it("requires a finite fixed value", () => {
			const definition = basicAddition({
				variables: [
					{ name: "x", source: { kind: "fixed", value: Number.POSITIVE_INFINITY } },
					{ name: "y", source: { kind: "integer", min: 1, max: 10 } },
				],
			});
			expect(messagesAt(definition, "variables.0.value")).toEqual(["The value must be a number."]);
		});
	});

	describe("steps", () => {
		it("requires at least one step and an answer", () => {
			expect(messagesAt(basicAddition({ steps: [] }), "steps")[0]).toContain("Add at least one step");
			const noAnswer = basicAddition({ steps: [{ target: "z", expression: "{x} + {y}" }] });
			expect(messagesAt(noAnswer, "steps")[0]).toContain("No step calculates {answer}");
		});

		it("reports malformed expressions with their position", () => {
			const definition = basicAddition({ steps: [{ target: "answer", expression: "{x} + * {y}" }] });
			expect(messagesAt(definition, "steps.0.expression")).toEqual(['Unexpected "*" (at character 7)']);
		});

		it("rejects undefined variables", () => {
			const definition = basicAddition({ steps: [{ target: "answer", expression: "{x} + {q}" }] });
			expect(messagesAt(definition, "steps.0.expression")).toEqual(["{q} is not defined."]);
		});

		it("rejects references to values calculated later", () => {
			const definition = basicAddition({
				steps: [
					{ target: "answer", expression: "{z} * 2" },
					{ target: "z", expression: "{x} + {y}" },
				],
			});
			expect(messagesAt(definition, "steps.0.expression")[0]).toContain("calculated later, in step 2");
		});

		it("rejects self references", () => {
			const definition = basicAddition({ steps: [{ target: "answer", expression: "{answer} + {x} + {y}" }] });
			expect(messagesAt(definition, "steps.0.expression")).toEqual(["{answer} cannot be used in its own calculation."]);
		});

		it("rejects assigning inputs or assigning twice", () => {
			const definition = basicAddition({
				steps: [
					{ target: "x", expression: "1" },
					{ target: "z", expression: "{x} + {y}" },
					{ target: "z", expression: "{z} * 2" },
					{ target: "answer", expression: "{z}" },
				],
			});
			expect(messagesAt(definition, "steps.0.target")).toEqual(["{x} is an input variable and cannot be recalculated."]);
			expect(messagesAt(definition, "steps.2.target")).toEqual(["{z} is already calculated in step 2."]);
		});

		it("warns about calculated values that are never used", () => {
			const definition = basicAddition({
				steps: [
					{ target: "unused", expression: "{x} * 2" },
					{ target: "answer", expression: "{x} + {y}" },
				],
			});
			expect(hasErrors(validateDefinition(definition))).toBe(false);
			expect(messagesAt(definition, "steps.0.target")).toEqual(["{unused} is calculated but never used."]);
		});
	});

	describe("prompt", () => {
		it("rejects undefined variables outside math", () => {
			expect(messagesAt(basicAddition({ prompt: "What is {x} + {w}?" }), "prompt")[0]).toContain("{w} is not defined");
		});

		it("ignores LaTeX groups inside math", () => {
			expect(errorsOf(basicAddition({ prompt: "Evaluate $\\frac{x}{y}$ where $\\mathrm{d} = {x} + {y}$." }))).toEqual([]);
		});

		it("does not allow the prompt to reveal the answer", () => {
			expect(messagesAt(basicAddition({ prompt: "{x} + {y} = {answer}" }), "prompt")[0]).toContain("give the answer away");
		});

		it("allows intermediate values in the prompt", () => {
			const definition = basicAddition({
				prompt: "The total is {z}. Double it.",
				steps: [
					{ target: "z", expression: "{x} + {y}" },
					{ target: "answer", expression: "{z} * 2" },
				],
			});
			expect(validateDefinition(definition)).toEqual([]);
		});

		it("warns about unused inputs", () => {
			const definition = basicAddition({ prompt: "What is {x} doubled?", steps: [{ target: "answer", expression: "{x} * 2" }] });
			expect(messagesAt(definition, "variables.1.name")).toEqual(["{y} is not used in the question or any step."]);
		});
	});

	describe("answer rules", () => {
		it.each([
			[{ check: "rounded", places: -1 }, "answer.places"],
			[{ check: "rounded", places: 1.5 }, "answer.places"],
			[{ check: "rounded", places: 11 }, "answer.places"],
			[{ check: "absolute", tolerance: 0 }, "answer.tolerance"],
			[{ check: "relative", percent: 100 }, "answer.tolerance"],
		] as const)("rejects %j", (answer, path) => {
			expect(messagesAt(basicAddition({ answer }), path)).toHaveLength(1);
		});

		it("accepts zero decimal places", () => {
			expect(validateDefinition(basicAddition({ answer: { check: "rounded", places: 0 } }))).toEqual([]);
		});
	});
});
