import { describe, expect, it } from "vitest";
import { evaluate, ExpressionError, parseExpression, referencedVariables } from "../src/core/expression";

function calc(source: string, values: Record<string, number> = {}): number {
	return evaluate(parseExpression(source), new Map(Object.entries(values)));
}

function errorOf(source: string, values: Record<string, number> = {}): ExpressionError {
	try {
		calc(source, values);
	} catch (error) {
		if (error instanceof ExpressionError) return error;
		throw error;
	}
	throw new Error(`Expected "${source}" to fail`);
}

describe("arithmetic", () => {
	it("evaluates the four operations", () => {
		expect(calc("7 + 12")).toBe(19);
		expect(calc("7 - 12")).toBe(-5);
		expect(calc("3 * 4")).toBe(12);
		expect(calc("10 / 4")).toBe(2.5);
	});

	it("accepts decimals, leading dots and exponents", () => {
		expect(calc("1.5 + .5")).toBe(2);
		expect(calc("2.5e3")).toBe(2500);
		expect(calc("4E-2")).toBe(0.04);
	});

	it("accepts typographic operators", () => {
		expect(calc("6 × 2 ÷ 3 − 1")).toBe(3);
	});
});

describe("precedence", () => {
	it("multiplies before adding", () => {
		expect(calc("2 + 3 * 4")).toBe(14);
		expect(calc("2 * 3 + 4")).toBe(10);
		expect(calc("10 - 4 / 2")).toBe(8);
	});

	it("evaluates left to right at the same level", () => {
		expect(calc("10 - 4 - 3")).toBe(3);
		expect(calc("24 / 4 / 2")).toBe(3);
	});

	it("respects parentheses", () => {
		expect(calc("(2 + 3) * 4")).toBe(20);
		expect(calc("2 * (3 + (4 - 1))")).toBe(12);
	});

	it("treats exponentiation as right-associative and above unary minus", () => {
		expect(calc("2^3^2")).toBe(512);
		expect(calc("-2^2")).toBe(-4);
		expect(calc("(-2)^2")).toBe(4);
		expect(calc("2^-1")).toBe(0.5);
		expect(calc("2 * 3^2")).toBe(18);
	});

	it("supports repeated unary signs", () => {
		expect(calc("--3")).toBe(3);
		expect(calc("+3")).toBe(3);
		expect(calc("4 - -3")).toBe(7);
	});
});

describe("functions and constants", () => {
	it("computes roots and absolute values", () => {
		expect(calc("sqrt(16)")).toBe(4);
		expect(calc("cbrt(-27)")).toBe(-3);
		expect(calc("abs(-3.5)")).toBe(3.5);
	});

	it("uses radians for trigonometry, with deg() and rad() for conversion", () => {
		expect(calc("sin(pi / 2)")).toBe(1);
		expect(calc("cos(0)")).toBe(1);
		expect(calc("sin(rad(30))")).toBeCloseTo(0.5, 12);
		expect(calc("deg(atan(1))")).toBeCloseTo(45, 12);
		expect(calc("deg(acos(0))")).toBeCloseTo(90, 12);
		expect(calc("tan(rad(45))")).toBeCloseTo(1, 12);
	});

	it("computes logarithms", () => {
		expect(calc("ln(e)")).toBe(1);
		expect(calc("log(1000)")).toBeCloseTo(3, 12);
		expect(calc("log(8, 2)")).toBeCloseTo(3, 12);
		expect(calc("exp(0)")).toBe(1);
	});

	it("rounds and picks extremes", () => {
		expect(calc("round(2.5)")).toBe(3);
		expect(calc("round(-2.5)")).toBe(-3);
		expect(calc("floor(-1.5)")).toBe(-2);
		expect(calc("ceil(1.2)")).toBe(2);
		expect(calc("min(3, 1, 2)")).toBe(1);
		expect(calc("max(3, 1, 2)")).toBe(3);
	});

	it("checks argument counts", () => {
		expect(errorOf("sqrt(1, 2)").message).toContain("takes 1 argument");
		expect(errorOf("max()").message).toContain("at least 1");
	});
});

describe("variables", () => {
	it("resolves braces from the scope", () => {
		expect(calc("{x} + {y}", { x: 7, y: 12 })).toBe(19);
		expect(calc("sqrt({z}^2 + {z}^2)", { z: 9 })).toBeCloseTo(12.7279220614, 9);
	});

	it("allows spaces inside braces", () => {
		expect(calc("{ x } * 2", { x: 4 })).toBe(8);
	});

	it("rejects variables without a value", () => {
		expect(errorOf("{x} + {q}", { x: 1 }).message).toBe("{q} has no value at this point");
	});

	it("lists referenced variables once each", () => {
		expect(referencedVariables(parseExpression("{x} * {y} + {x} / max({z}, 2)"))).toEqual(["x", "y", "z"]);
	});
});

describe("malformed expressions", () => {
	it.each([
		["", "empty"],
		["2 +", "ends unexpectedly"],
		["(2 + 3", 'Expected ")"'],
		["2 + 3)", 'Unexpected ")"'],
		["2 {x}", "Use * for multiplication"],
		["{x", "Unclosed"],
		["{2x}", "not a valid variable"],
		["x + 1", "must be written in braces"],
		["foo(1)", 'Unknown function "foo"'],
		["sqrt", "needs parentheses"],
		["2 $ 3", 'Unexpected character "$"'],
		["2 ** 3", 'Unexpected "*"'],
	])("rejects %j", (source, message) => {
		expect(() => parseExpression(source)).toThrow(ExpressionError);
		expect(errorOf(source, { x: 1 }).message).toContain(message);
	});

	it("reports the position of the problem", () => {
		expect(errorOf("1 + foo(2)").position).toBe(4);
	});

	it("never evaluates JavaScript", () => {
		expect(() => parseExpression("constructor.constructor('return 1')()")).toThrow(ExpressionError);
		expect(() => parseExpression("{__proto__}")).not.toThrow();
		expect(errorOf("{__proto__}").message).toContain("has no value");
	});
});

describe("invalid mathematics", () => {
	it("detects division by zero", () => {
		expect(errorOf("1 / 0").message).toBe("Division by zero");
		expect(errorOf("{x} / ({y} - {y})", { x: 1, y: 3 }).message).toBe("Division by zero");
		expect(errorOf("0^-1").message).toContain("Division by zero");
	});

	it("detects domain errors", () => {
		expect(errorOf("sqrt(-1)").message).toContain("must not be negative");
		expect(errorOf("ln(0)").message).toContain("greater than 0");
		expect(errorOf("log(-5)").message).toContain("greater than 0");
		expect(errorOf("log(8, 1)").message).toContain("not 1");
		expect(errorOf("asin(2)").message).toContain("between -1 and 1");
		expect(errorOf("(-8)^(1/3)").message).toContain("not a real number");
	});

	it("rejects non-finite results", () => {
		expect(errorOf("10^400").message).toContain("too large");
		expect(errorOf("exp(1000)").message).toContain("too large");
		expect(errorOf("1e308 * 10").message).toContain("too large");
	});
});
