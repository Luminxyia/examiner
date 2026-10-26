import { describe, expect, it } from "vitest";
import { hasAnyTag, normaliseTag, normaliseTags, tagMatches } from "../src/core/tags";
import { findMathRanges, findTemplateReferences, renderTemplate } from "../src/core/template";

describe("prompt templates", () => {
	it("finds references and their math context", () => {
		const references = findTemplateReferences("Use {x}, $\\sqrt{y}$ and $$ {z} $$, not \\{w\\} or {1}.");
		expect(references.map(({ name, inMath }) => [name, inMath])).toEqual([
			["x", false],
			["y", true],
			["z", true],
		]);
	});

	it("replaces every occurrence and leaves unknown names alone", () => {
		const values = new Map([["x", "5"]]);
		expect(renderTemplate("{x} and { x } but not {q}", values)).toBe("5 and 5 but not {q}");
	});

	it("finds inline and display math like Obsidian", () => {
		const ranges = findMathRanges("a $x^2$ b $$\n\\frac{1}{2}\n$$ c $ 5 and $6 \\$ 7");
		expect(ranges.map(({ source, display }) => [source, display])).toEqual([
			["x^2", false],
			["\n\\frac{1}{2}\n", true],
		]);
		expect(findMathRanges("price \\$5 and $unclosed")).toEqual([]);
		expect(findMathRanges("$a$")[0]).toMatchObject({ from: 0, to: 3 });
	});

	it("leaves the template unchanged", () => {
		const template = "What is {x}?";
		renderTemplate(template, new Map([["x", "3"]]));
		expect(template).toBe("What is {x}?");
	});
});

describe("tags", () => {
	it("normalises spacing, slashes and hashes", () => {
		expect(normaliseTag(" #Physics // Circuits ")).toBe("Physics/Circuits");
		expect(normaliseTag("exam revision")).toBe("exam-revision");
		expect(normaliseTag("a\\b")).toBe("a/b");
		expect(normaliseTag(" / ")).toBeNull();
	});

	it("removes duplicates ignoring case, keeping the first spelling", () => {
		expect(normaliseTags(["Maths", "maths", " ", "physics", "MATHS"])).toEqual(["Maths", "physics"]);
	});

	it("matches nested tags by prefix", () => {
		expect(tagMatches("electrical-engineering/circuits", "Electrical-Engineering")).toBe(true);
		expect(tagMatches("electrical", "electrical-engineering")).toBe(false);
		expect(tagMatches("electrical-engineering-2", "electrical-engineering")).toBe(false);
		expect(hasAnyTag(["maths", "difficult"], ["physics", "difficult"])).toBe(true);
		expect(hasAnyTag(["maths"], ["physics"])).toBe(false);
	});
});
