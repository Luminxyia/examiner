import { describe, expect, it } from "vitest";
import { parseDiagram, type DiagramShape } from "../src/core/diagram";

const POINTS = ["point A at 0, 0", "point B at 4, 0", "point C at 4, 3"].join("\n");

function shapesOf(lines: string): DiagramShape[] {
	const diagram = parseDiagram(`${POINTS}\n${lines}`);
	expect(diagram.errors).toEqual([]);
	return diagram.shapes;
}

function errorsOf(source: string): string[] {
	return parseDiagram(source).errors.map((error) => `Line ${error.line}: ${error.message}`);
}

describe("points", () => {
	it("reads positions with or without a comma", () => {
		const shapes = parseDiagram("point A at 1.5, -2\npoint B at 3 4\nline A B").shapes;
		expect(shapes).toEqual([
			{
				kind: "line",
				points: [
					{ x: 1.5, y: -2 },
					{ x: 3, y: 4 },
				],
				closed: false,
				style: { thick: false, dashed: false },
				label: null,
			},
		]);
	});

	it("accepts a typographic minus sign", () => {
		const shapes = parseDiagram("point A at −2, 0\npoint B at 0, 0\nline A B").shapes;
		const line = shapes[0];
		expect(line?.kind === "line" && line.points[0]?.x).toBe(-2);
	});

	it("lets shapes use points defined later", () => {
		expect(parseDiagram("line A B\npoint A at 0, 0\npoint B at 1, 0").errors).toEqual([]);
	});

	it("rejects a point defined twice", () => {
		expect(errorsOf("point A at 0, 0\npoint A at 1, 1")).toEqual(["Line 2: Point A is already defined."]);
	});

	it("rejects command words as point names", () => {
		expect(errorsOf("point label at 0, 0")).toEqual(['Line 1: "label" cannot be used as a point name.']);
	});

	it("rejects a missing position", () => {
		expect(errorsOf("point A at 0")).toEqual(["Line 1: Expected a y position but the line ended."]);
	});
});

describe("shapes", () => {
	it("reads a line with every option", () => {
		const [line] = shapesOf('line A B C closed thick dashed label "frame" below');
		expect(line).toMatchObject({
			kind: "line",
			closed: true,
			style: { thick: true, dashed: true },
			label: { text: "frame", placement: "below" },
		});
	});

	it("reads rectangles, circles and arcs", () => {
		const shapes = shapesOf('rectangle A C label "m = {m} kg"\ncircle at A radius 0.5\narc at A radius 2 from 0 to 90 dashed');
		expect(shapes.map((shape) => shape.kind)).toEqual(["rectangle", "circle", "arc"]);
		expect(shapes[0]).toMatchObject({ label: { text: "m = {m} kg", placement: null } });
		expect(shapes[2]).toMatchObject({ radius: 2, start: 0, end: 90, style: { dashed: true } });
	});

	it("reads fills with a pattern", () => {
		const [fill] = shapesOf("fill A B C with dots");
		expect(fill).toMatchObject({ kind: "fill", pattern: "dots" });
	});

	it("reads arrows between points", () => {
		const [arrow] = shapesOf('arrow from A to C label "F"');
		expect(arrow).toEqual({ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 4, y: 3 }, label: { text: "F", placement: null } });
	});

	it("reads arrows from an angle and length", () => {
		const [arrow] = shapesOf("arrow at A angle 90 length 2");
		expect(arrow?.kind).toBe("arrow");
		if (arrow?.kind !== "arrow") return;
		expect(arrow.to.x).toBeCloseTo(0);
		expect(arrow.to.y).toBeCloseTo(2);
	});

	it("reads moments", () => {
		const [moment] = shapesOf('moment at B radius 0.6 clockwise label "M"');
		expect(moment).toMatchObject({ kind: "moment", clockwise: true, radius: 0.6 });
	});

	it("requires a moment direction", () => {
		expect(errorsOf(`${POINTS}\nmoment at A radius 1`)).toEqual(["Line 4: A moment needs clockwise or anticlockwise."]);
	});

	it("reads uniform and sloping distributed loads", () => {
		const shapes = shapesOf("distributed from A to B down length 1\ndistributed from A to C right length 0 to 2");
		expect(shapes[0]).toMatchObject({ direction: "down", startLength: 1, endLength: 1 });
		expect(shapes[1]).toMatchObject({ direction: "right", startLength: 0, endLength: 2 });
	});

	it("reads dimensions, angles, ground and labels", () => {
		const shapes = shapesOf('dimension B C label "h = {h} m" right\nangle B A C label "θ"\nground A B\nlabel "A" at A below');
		expect(shapes[0]).toMatchObject({ kind: "dimension", side: "right", label: { text: "h = {h} m", placement: "right" } });
		expect(shapes[1]).toMatchObject({ kind: "angle", label: { text: "θ" } });
		expect(shapes[2]).toMatchObject({ kind: "ground", side: null });
		expect(shapes[3]).toEqual({ kind: "label", at: { x: 0, y: 0 }, text: "A", placement: "below" });
	});

	it("ignores blank lines", () => {
		expect(shapesOf("\n   \nline A B\n")).toHaveLength(1);
	});
});

describe("errors", () => {
	it("names unknown commands", () => {
		expect(errorsOf("triangle A B C")).toEqual(['Line 1: "triangle" is not a diagram command.']);
	});

	it("names undefined points", () => {
		expect(errorsOf(`${POINTS}\nline A D`)).toEqual(["Line 4: Point D is not defined."]);
	});

	it("names unknown options", () => {
		expect(errorsOf(`${POINTS}\nline A B bold`)).toEqual(['Line 4: "bold" is not an option here.']);
	});

	it("names unknown fill patterns", () => {
		expect(errorsOf(`${POINTS}\nfill A B C with stripes`)).toEqual([
			'Line 4: Expected a fill pattern (hatch, dots, lines, grey) but found "stripes".',
		]);
	});

	it("rejects text without a closing quote", () => {
		expect(errorsOf(`${POINTS}\nlabel "A at A`)).toEqual(["Line 4: Text in quotes is missing its closing quote."]);
	});

	it("rejects a radius of zero", () => {
		expect(errorsOf(`${POINTS}\ncircle at A radius 0`)).toEqual(["Line 4: Expected a radius more than 0 but found 0."]);
	});

	it("rejects a distributed load with no length", () => {
		expect(errorsOf(`${POINTS}\ndistributed from A to B down length 0`)).toEqual(["Line 4: At least one length must be more than 0."]);
	});

	it("reports every bad line in order", () => {
		expect(errorsOf("line A B\npoint A at 0, 0\nfoo")).toEqual(["Line 1: Point B is not defined.", 'Line 3: "foo" is not a diagram command.']);
	});
});
