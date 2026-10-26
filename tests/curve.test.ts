import { describe, expect, it } from "vitest";
import { easeOutCubic, linePath, sampleSeries } from "../src/core/curve";

describe("linePath", () => {
	it("handles no points and one point", () => {
		expect(linePath([])).toBe("");
		expect(linePath([{ x: 10, y: 20 }])).toBe("M10,20");
	});

	it("joins every recorded point with straight segments", () => {
		const path = linePath([
			{ x: 0, y: 50 },
			{ x: 10, y: 70 },
			{ x: 20, y: 10 },
		]);
		expect(path).toBe("M0,50 L10,70 L20,10");
		expect(path).not.toContain("C");
	});
});

describe("sampleSeries", () => {
	it("interpolates a series at a fraction of its length", () => {
		expect(sampleSeries([], 0.5)).toBeUndefined();
		expect(sampleSeries([40], 0.9)).toBe(40);
		expect(sampleSeries([0, 100], 0.25)).toBe(25);
		expect(sampleSeries([10, 20, 30], 1)).toBe(30);
		expect(sampleSeries([10, 20, 30], 2)).toBe(30);
	});
});

describe("easeOutCubic", () => {
	it("starts at 0, ends at 1 and never overshoots", () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(1)).toBe(1);
		for (let t = 0; t <= 1; t += 0.05) {
			expect(easeOutCubic(t)).toBeGreaterThanOrEqual(0);
			expect(easeOutCubic(t)).toBeLessThanOrEqual(1);
		}
	});
});
