import { describe, expect, it } from "vitest";
import { easeOutCubic, monotonePath, sampleSeries, type Point } from "../src/core/curve";

function segments(path: string): number[][] {
	return [...path.matchAll(/C([^C]+)/g)].map((match) => (match[1] ?? "").trim().split(/[ ,]+/).map(Number));
}

describe("monotonePath", () => {
	it("handles no points, one point and two points", () => {
		expect(monotonePath([])).toBe("");
		expect(monotonePath([{ x: 10, y: 20 }])).toBe("M10,20");
		const two = monotonePath([
			{ x: 0, y: 100 },
			{ x: 30, y: 40 },
		]);
		expect(two.startsWith("M0,100")).toBe(true);
		expect(two.endsWith("30,40")).toBe(true);
	});

	it("passes exactly through every recorded point", () => {
		const points: Point[] = [
			{ x: 0, y: 50 },
			{ x: 10, y: 70 },
			{ x: 20, y: 10 },
			{ x: 30, y: 90 },
		];
		const path = monotonePath(points);
		expect(path.startsWith("M0,50")).toBe(true);
		const ends = segments(path).map((values) => [values[4], values[5]]);
		expect(ends).toEqual([
			[10, 70],
			[20, 10],
			[30, 90],
		]);
	});

	it("never overshoots between points, even with sharp changes", () => {
		const points: Point[] = [
			{ x: 0, y: 200 },
			{ x: 10, y: 200 },
			{ x: 20, y: 0 },
			{ x: 30, y: 10 },
			{ x: 40, y: 200 },
			{ x: 50, y: 195 },
		];
		segments(monotonePath(points)).forEach((values, index) => {
			const a = points[index];
			const b = points[index + 1];
			const low = Math.min(a.y, b.y);
			const high = Math.max(a.y, b.y);
			for (const controlY of [values[1], values[3]]) {
				expect(controlY).toBeGreaterThanOrEqual(low - 1e-9);
				expect(controlY).toBeLessThanOrEqual(high + 1e-9);
			}
		});
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
