import { finishRenderMath, renderMath, setIcon } from "obsidian";
import {
	findJunctions,
	parseDiagram,
	placeLocal,
	type Diagram,
	type DiagramPoint,
	type DiagramShape,
	type Direction,
	type FillPattern,
	type LineStyle,
	type Placement,
	type ShapeLabel,
} from "../core/diagram";
import { CONNECTED_SYMBOLS, NAMED_SYMBOLS, PLACED_SYMBOLS, type LocalPoint, type SymbolPart, type SymbolStroke } from "../core/diagram-symbols";
import { findMathRanges } from "../core/template";

const SVG_NS = "http://www.w3.org/2000/svg";
const TARGET_WIDTH = 440;
const TARGET_HEIGHT = 300;
const MIN_SCALE = 5;
const MAX_SCALE = 80;
const PADDING = 8;
const FONT_SIZE = 14;
const LABEL_GAP = 6;
const STROKE = 1.5;
const THICK_STROKE = 3;
const HEAD_LENGTH = 10;
const HEAD_HALF_WIDTH = 4;
const DIMENSION_OFFSET = 18;
const ANGLE_RADIUS = 22;
const GROUND_SPACING = 8;
const GROUND_DEPTH = 7;
const DISTRIBUTED_SPACING = 22;
const ARC_SEGMENTS = 48;
const CIRCLE_SEGMENTS = 24;
const JUNCTION_RADIUS = 3;
const SYMBOL_FONT_SIZE = 12;
const SYMBOL_STROKES: Record<SymbolStroke, number> = { thin: 1, normal: 1.5, thick: 3, heavy: 4 };

interface Vector {
	x: number;
	y: number;
}

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

interface Segment {
	from: Vector;
	to: Vector;
}

type LabelPlacement = Placement | "centre";

interface LabelSpot {
	anchor: Vector;
	placement: LabelPlacement;
}

interface LabelRequest {
	text: string;
	spots: LabelSpot[];
	line: number;
}

export interface DiagramViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DiagramViewOptions {
	scale: number;
	viewBox: DiagramViewBox;
}

interface TextLayout {
	x: number;
	y: number;
	textAnchor: string;
	box: Box;
}

interface PreparedLabel {
	width: number;
	height: number;
	math: HTMLElement | null;
}

let diagramCount = 0;

function createMathLabel(text: string): HTMLElement {
	const label = createSpan({ cls: "examiner-diagram-math" });
	let position = 0;
	for (const range of findMathRanges(text)) {
		label.appendText(text.slice(position, range.from));
		label.appendChild(renderMath(range.source, false));
		position = range.to;
	}
	label.appendText(text.slice(position));
	return label;
}

function prepareLabel(text: string): PreparedLabel {
	if (findMathRanges(text).length === 0) {
		return { width: text.length * FONT_SIZE * 0.6, height: FONT_SIZE, math: null };
	}
	const math = createMathLabel(text);
	const host = activeDocument.body.createDiv({ cls: "examiner-diagram-measure" });
	host.appendChild(math);
	const size = math.getBoundingClientRect();
	host.remove();
	const width = Math.ceil(size.width) + 1;
	const height = Math.max(FONT_SIZE, Math.ceil(size.height));
	return { width, height, math };
}

export function renderDiagram(container: HTMLElement, source: string): void {
	container.empty();
	const diagram = parseDiagram(source);
	if (diagram.errors.length > 0) {
		const list = container.createDiv({ cls: "examiner-diagram-errors examiner-error-text" });
		for (const error of diagram.errors) list.createDiv({ text: `Line ${error.line}: ${error.message}` });
		return;
	}
	if (diagram.shapes.length === 0) return;
	drawDiagram(container, diagram, null);
}

export function renderDiagramView(container: HTMLElement, diagram: Diagram, view: DiagramViewOptions): SVGSVGElement {
	return drawDiagram(container, diagram, view);
}

export function diagramScale(diagram: Diagram): number {
	return chooseScale(diagram.shapes);
}

function drawDiagram(container: HTMLElement, diagram: Diagram, view: DiagramViewOptions | null): SVGSVGElement {
	diagramCount++;
	const drawing = new Drawing(container, `examiner-diagram-${diagramCount}`, diagram.shapes, view);
	diagram.shapes.forEach((shape, index) => {
		if (shape.kind === "wire") drawing.draw(shape, diagram.sources[index]?.line ?? 0);
	});
	diagram.shapes.forEach((shape, index) => {
		if (shape.kind !== "wire") drawing.draw(shape, diagram.sources[index]?.line ?? 0);
	});
	for (const junction of findJunctions(diagram.shapes)) drawing.drawJunction(junction);
	drawing.finish();
	return drawing.element;
}

function svgElement<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
	const element = activeDocument.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
	parent.appendChild(element);
	return element;
}

function unit(vector: Vector): Vector {
	const length = Math.hypot(vector.x, vector.y);
	if (length === 0) return { x: 0, y: 0 };
	return { x: vector.x / length, y: vector.y / length };
}

function placementVector(placement: Placement): Vector {
	if (placement === "above") return { x: 0, y: -1 };
	if (placement === "below") return { x: 0, y: 1 };
	if (placement === "left") return { x: -1, y: 0 };
	return { x: 1, y: 0 };
}

function placementFromVector(vector: Vector): Placement {
	if (Math.abs(vector.x) > Math.abs(vector.y)) {
		if (vector.x > 0) return "right";
		return "left";
	}
	if (vector.y > 0) return "below";
	return "above";
}

function oppositePlacement(placement: Placement): Placement {
	if (placement === "above") return "below";
	if (placement === "below") return "above";
	if (placement === "left") return "right";
	return "left";
}

function directionPlacement(direction: Direction): Placement {
	if (direction === "up") return "above";
	if (direction === "down") return "below";
	return direction;
}

function defaultSide(a: Vector, b: Vector): Placement {
	if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return "below";
	return "right";
}

function pointsText(points: readonly Vector[]): string {
	return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function cross(origin: Vector, a: Vector, b: Vector): number {
	return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function segmentsCross(a: Segment, b: Segment): boolean {
	const d1 = cross(b.from, b.to, a.from);
	const d2 = cross(b.from, b.to, a.to);
	const d3 = cross(a.from, a.to, b.from);
	const d4 = cross(a.from, a.to, b.to);
	const aStraddlesB = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
	const bStraddlesA = (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
	return aStraddlesB && bStraddlesA;
}

function pointInBox(point: Vector, box: Box): boolean {
	return point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
}

function boxHitsSegment(box: Box, segment: Segment): boolean {
	if (pointInBox(segment.from, box) || pointInBox(segment.to, box)) return true;
	const topLeft = { x: box.left, y: box.top };
	const topRight = { x: box.right, y: box.top };
	const bottomLeft = { x: box.left, y: box.bottom };
	const bottomRight = { x: box.right, y: box.bottom };
	const edges: Segment[] = [
		{ from: topLeft, to: topRight },
		{ from: topRight, to: bottomRight },
		{ from: bottomRight, to: bottomLeft },
		{ from: bottomLeft, to: topLeft },
	];
	for (const edge of edges) {
		if (segmentsCross(edge, segment)) return true;
	}
	return false;
}

function boxesOverlap(a: Box, b: Box): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function shapeExtent(shape: DiagramShape): DiagramPoint[] {
	switch (shape.kind) {
		case "line":
		case "fill":
		case "wire":
			return shape.points;
		case "connected-symbol":
			return [shape.from, shape.to];
		case "placed-symbol":
		case "named-symbol":
			return [
				{ x: shape.at.x - shape.size, y: shape.at.y - shape.size },
				{ x: shape.at.x + shape.size, y: shape.at.y + shape.size },
			];
		case "rectangle":
		case "arrow":
		case "dimension":
		case "ground":
			return [shape.from, shape.to];
		case "circle":
		case "arc":
		case "moment":
			return [
				{ x: shape.centre.x - shape.radius, y: shape.centre.y - shape.radius },
				{ x: shape.centre.x + shape.radius, y: shape.centre.y + shape.radius },
			];
		case "distributed":
			return [shape.from, shape.to];
		case "angle":
			return [shape.vertex];
		case "label":
			return [shape.at];
	}
}

function chooseScale(shapes: readonly DiagramShape[]): number {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const shape of shapes) {
		for (const point of shapeExtent(shape)) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
	}
	const width = maxX - minX;
	const height = maxY - minY;
	let scale = MAX_SCALE;
	if (width > 0) scale = Math.min(scale, TARGET_WIDTH / width);
	if (height > 0) scale = Math.min(scale, TARGET_HEIGHT / height);
	return Math.max(MIN_SCALE, scale);
}

class Drawing {
	private readonly svg: SVGSVGElement;
	private readonly defs: SVGDefsElement;
	private readonly shapesLayer: SVGGElement;
	private readonly textLayer: SVGGElement;
	private readonly scale: number;
	private readonly bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	private readonly patterns = new Set<FillPattern>();
	private readonly segments: Segment[] = [];
	private readonly labels: LabelRequest[] = [];
	private group: SVGGElement;
	private currentLine = 0;

	constructor(
		container: HTMLElement,
		private readonly id: string,
		shapes: readonly DiagramShape[],
		private readonly view: DiagramViewOptions | null,
	) {
		this.scale = view?.scale ?? chooseScale(shapes);
		this.svg = svgElement(container.createDiv({ cls: "examiner-diagram" }), "svg", { role: "img" });
		this.defs = svgElement(this.svg, "defs", {});
		this.shapesLayer = svgElement(this.svg, "g", {});
		this.textLayer = svgElement(this.svg, "g", {});
		this.group = this.shapesLayer;
	}

	get element(): SVGSVGElement {
		return this.svg;
	}

	finish(): void {
		this.placeLabels();
		if (this.view !== null) {
			const box = this.view.viewBox;
			this.svg.setAttribute("viewBox", `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`);
			return;
		}
		const { minX, minY, maxX, maxY } = this.bounds;
		if (!Number.isFinite(minX)) return;
		const x = minX - PADDING;
		const y = minY - PADDING;
		const width = maxX - minX + PADDING * 2;
		const height = maxY - minY + PADDING * 2;
		this.svg.setAttribute("viewBox", `${round(x)} ${round(y)} ${round(width)} ${round(height)}`);
		this.svg.setAttribute("width", String(round(width)));
		this.svg.setAttribute("height", String(round(height)));
	}

	draw(shape: DiagramShape, line: number): void {
		this.currentLine = line;
		this.group = svgElement(this.shapesLayer, "g", { "data-line": line });
		switch (shape.kind) {
			case "line":
				this.drawLine(shape.points, shape.closed, shape.style, shape.label);
				break;
			case "rectangle":
				this.drawRectangle(shape.from, shape.to, shape.style, shape.label);
				break;
			case "circle":
				this.drawCircle(shape.centre, shape.radius, shape.style, shape.label);
				break;
			case "arc":
				this.drawArc(shape.centre, shape.radius, shape.start, shape.end, shape.style, shape.label);
				break;
			case "fill":
				this.drawFill(shape.points, shape.pattern);
				break;
			case "arrow":
				this.drawArrowShape(shape.from, shape.to, shape.label);
				break;
			case "moment":
				this.drawMoment(shape.centre, shape.radius, shape.clockwise, shape.label);
				break;
			case "distributed":
				this.drawDistributed(shape);
				break;
			case "dimension":
				this.drawDimension(shape.from, shape.to, shape.side, shape.label);
				break;
			case "angle":
				this.drawAngle(shape.first, shape.vertex, shape.second, shape.label);
				break;
			case "ground":
				this.drawGround(shape.from, shape.to, shape.side);
				break;
			case "label":
				this.drawFreeLabel(shape.at, shape.text, shape.placement);
				break;
			case "wire":
				this.polyline(
					shape.points.map((point) => this.toScreen(point)),
					{ thick: false, dashed: false },
					false,
				);
				break;
			case "connected-symbol":
				this.drawConnectedSymbol(shape);
				break;
			case "placed-symbol":
				this.drawPlacedSymbol(shape.symbol, shape.at, shape.angle, shape.size, shape.label);
				break;
			case "named-symbol":
				this.drawNamedSymbol(shape.symbol, shape.at, shape.angle, shape.size, shape.label);
				break;
		}
	}

	drawJunction(point: DiagramPoint): void {
		this.group = this.shapesLayer;
		const centre = this.toScreen(point);
		this.include({ x: centre.x - JUNCTION_RADIUS, y: centre.y - JUNCTION_RADIUS });
		this.include({ x: centre.x + JUNCTION_RADIUS, y: centre.y + JUNCTION_RADIUS });
		svgElement(this.group, "circle", { cx: round(centre.x), cy: round(centre.y), r: JUNCTION_RADIUS, fill: "currentColor", stroke: "none" });
	}

	private toScreen(point: DiagramPoint): Vector {
		return { x: point.x * this.scale, y: -point.y * this.scale };
	}

	private include(point: Vector): void {
		this.bounds.minX = Math.min(this.bounds.minX, point.x);
		this.bounds.minY = Math.min(this.bounds.minY, point.y);
		this.bounds.maxX = Math.max(this.bounds.maxX, point.x);
		this.bounds.maxY = Math.max(this.bounds.maxY, point.y);
	}

	private recordPath(points: readonly Vector[], closed: boolean): void {
		for (let index = 1; index < points.length; index++) {
			const from = points[index - 1];
			const to = points[index];
			if (from !== undefined && to !== undefined) this.segments.push({ from, to });
		}
		const first = points[0];
		const last = points[points.length - 1];
		if (closed && first !== undefined && last !== undefined) this.segments.push({ from: last, to: first });
		if (this.view !== null && points.length > 1) {
			const tag = closed ? "polygon" : "polyline";
			svgElement(this.group, tag, { points: pointsText(points), class: "examiner-diagram-hit" });
		}
	}

	private recordCircle(centre: Vector, radius: number): void {
		const ring: Vector[] = [];
		for (let index = 0; index < CIRCLE_SEGMENTS; index++) {
			const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
			ring.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
		}
		this.recordPath(ring, true);
	}

	private strokeAttrs(style: LineStyle): Record<string, string | number> {
		const attrs: Record<string, string | number> = {
			fill: "none",
			stroke: "currentColor",
			"stroke-width": style.thick ? THICK_STROKE : STROKE,
			"stroke-linejoin": "round",
			"stroke-linecap": "round",
		};
		if (style.dashed) attrs["stroke-dasharray"] = "6 4";
		return attrs;
	}

	private polyline(points: readonly Vector[], style: LineStyle, closed: boolean): void {
		for (const point of points) this.include(point);
		this.recordPath(points, closed);
		const tag = closed ? "polygon" : "polyline";
		svgElement(this.group, tag, { points: pointsText(points), ...this.strokeAttrs(style) });
	}

	private arcPoints(centre: Vector, radius: number, startRadians: number, endRadians: number): Vector[] {
		const points: Vector[] = [];
		for (let index = 0; index <= ARC_SEGMENTS; index++) {
			const angle = startRadians + ((endRadians - startRadians) * index) / ARC_SEGMENTS;
			points.push({ x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) });
		}
		return points;
	}

	private arrowHead(tip: Vector, direction: Vector): void {
		const along = unit(direction);
		const across = { x: -along.y, y: along.x };
		const base = { x: tip.x - along.x * HEAD_LENGTH, y: tip.y - along.y * HEAD_LENGTH };
		const corners = [
			tip,
			{ x: base.x + across.x * HEAD_HALF_WIDTH, y: base.y + across.y * HEAD_HALF_WIDTH },
			{ x: base.x - across.x * HEAD_HALF_WIDTH, y: base.y - across.y * HEAD_HALF_WIDTH },
		];
		for (const corner of corners) this.include(corner);
		this.recordPath(corners, true);
		svgElement(this.group, "polygon", { points: pointsText(corners), fill: "currentColor", stroke: "none" });
	}

	private arrow(from: Vector, to: Vector): void {
		const direction = unit({ x: to.x - from.x, y: to.y - from.y });
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		if (length > HEAD_LENGTH) {
			const end = { x: to.x - direction.x * HEAD_LENGTH, y: to.y - direction.y * HEAD_LENGTH };
			this.polyline([from, end], { thick: false, dashed: false }, false);
		}
		this.arrowHead(to, direction);
	}

	private requestLabel(label: ShapeLabel | null, anchor: Vector, fallback: LabelPlacement): void {
		if (label === null) return;
		if (label.placement !== null) {
			this.labels.push({ line: this.currentLine, text: label.text, spots: [{ anchor, placement: label.placement }] });
			return;
		}
		if (fallback === "centre") {
			this.labels.push({ line: this.currentLine, text: label.text, spots: [{ anchor, placement: "centre" }] });
			return;
		}
		this.labels.push({
			line: this.currentLine,
			text: label.text,
			spots: [
				{ anchor, placement: fallback },
				{ anchor, placement: oppositePlacement(fallback) },
			],
		});
	}

	private layoutText(spot: LabelSpot, width: number, height: number): TextLayout {
		const anchor = spot.anchor;
		let x = anchor.x;
		let y = anchor.y;
		let textAnchor = "middle";
		if (spot.placement === "above") {
			y = anchor.y - LABEL_GAP - height / 2;
		} else if (spot.placement === "below") {
			y = anchor.y + LABEL_GAP + height / 2;
		} else if (spot.placement === "left") {
			x = anchor.x - LABEL_GAP;
			textAnchor = "end";
		} else if (spot.placement === "right") {
			x = anchor.x + LABEL_GAP;
			textAnchor = "start";
		}
		let left = x - width / 2;
		if (textAnchor === "end") left = x - width;
		if (textAnchor === "start") left = x;
		const box = { left, top: y - height / 2, right: left + width, bottom: y + height / 2 };
		return { x, y, textAnchor, box };
	}

	private writeMath(box: Box, math: HTMLElement, line: number): void {
		const element = svgElement(this.textLayer, "foreignObject", {
			x: round(box.left),
			y: round(box.top),
			width: round(box.right - box.left),
			height: round(box.bottom - box.top),
			class: "examiner-diagram-math-label",
			"data-line": line,
		});
		element.appendChild(math);
	}

	private writeText(x: number, y: number, textAnchor: string, text: string, fontSize: number, line: number): void {
		const element = svgElement(this.textLayer, "text", {
			x: round(x),
			y: round(y),
			"text-anchor": textAnchor,
			"dominant-baseline": "central",
			"font-size": fontSize,
			fill: "currentColor",
			class: "examiner-diagram-label",
			"data-line": line,
		});
		element.textContent = text;
	}

	private spotIsClear(box: Box, placed: readonly Box[]): boolean {
		const inner = { left: box.left + 1, top: box.top + 1, right: box.right - 1, bottom: box.bottom - 1 };
		for (const segment of this.segments) {
			if (boxHitsSegment(inner, segment)) return false;
		}
		for (const other of placed) {
			if (boxesOverlap(inner, other)) return false;
		}
		return true;
	}

	private placeLabels(): void {
		const placed: Box[] = [];
		let hasMath = false;
		for (const request of this.labels) {
			if (request.text === "") continue;
			const first = request.spots[0];
			if (first === undefined) continue;
			const label = prepareLabel(request.text);
			let chosen = this.layoutText(first, label.width, label.height);
			for (const spot of request.spots) {
				const layout = this.layoutText(spot, label.width, label.height);
				if (this.spotIsClear(layout.box, placed)) {
					chosen = layout;
					break;
				}
			}
			placed.push(chosen.box);
			this.include({ x: chosen.box.left, y: chosen.box.top });
			this.include({ x: chosen.box.right, y: chosen.box.bottom });
			if (label.math === null) {
				this.writeText(chosen.x, chosen.y, chosen.textAnchor, request.text, FONT_SIZE, request.line);
			} else {
				this.writeMath(chosen.box, label.math, request.line);
				hasMath = true;
			}
		}
		if (hasMath) void finishRenderMath();
	}

	private drawFreeLabel(at: DiagramPoint, text: string, placement: Placement | null): void {
		const anchor = this.toScreen(at);
		if (placement !== null) {
			this.labels.push({ line: this.currentLine, text, spots: [{ anchor, placement }] });
			return;
		}
		this.labels.push({
			line: this.currentLine,
			text,
			spots: [
				{ anchor, placement: "above" },
				{ anchor, placement: "below" },
				{ anchor, placement: "right" },
				{ anchor, placement: "left" },
			],
		});
	}

	private drawLine(points: readonly DiagramPoint[], closed: boolean, style: LineStyle, label: ShapeLabel | null): void {
		const screen = points.map((point) => this.toScreen(point));
		this.polyline(screen, style, closed);
		const first = screen[0];
		const second = screen[1];
		if (first === undefined || second === undefined) return;
		const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
		this.requestLabel(label, middle, "above");
	}

	private drawRectangle(from: DiagramPoint, to: DiagramPoint, style: LineStyle, label: ShapeLabel | null): void {
		const a = this.toScreen(from);
		const b = this.toScreen(to);
		const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
		this.polyline(corners, style, true);
		const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		this.requestLabel(label, centre, "centre");
	}

	private drawCircle(centre: DiagramPoint, radius: number, style: LineStyle, label: ShapeLabel | null): void {
		const middle = this.toScreen(centre);
		const size = radius * this.scale;
		this.include({ x: middle.x - size, y: middle.y - size });
		this.include({ x: middle.x + size, y: middle.y + size });
		this.recordCircle(middle, size);
		svgElement(this.group, "circle", { cx: round(middle.x), cy: round(middle.y), r: round(size), ...this.strokeAttrs(style) });
		this.requestLabel(label, middle, "centre");
	}

	private drawArc(centre: DiagramPoint, radius: number, start: number, end: number, style: LineStyle, label: ShapeLabel | null): void {
		const middle = this.toScreen(centre);
		const size = radius * this.scale;
		const startRadians = (start * Math.PI) / 180;
		const endRadians = (end * Math.PI) / 180;
		this.polyline(this.arcPoints(middle, size, startRadians, endRadians), style, false);
		const halfway = (startRadians + endRadians) / 2;
		const outward = { x: Math.cos(halfway), y: -Math.sin(halfway) };
		const anchor = { x: middle.x + outward.x * size, y: middle.y + outward.y * size };
		this.requestLabel(label, anchor, placementFromVector(outward));
	}

	private patternId(pattern: FillPattern): string {
		const id = `${this.id}-${pattern}`;
		if (this.patterns.has(pattern)) return id;
		this.patterns.add(pattern);
		const element = svgElement(this.defs, "pattern", { id, patternUnits: "userSpaceOnUse", width: 8, height: 8 });
		const line = { stroke: "currentColor", "stroke-width": 1, fill: "none" };
		if (pattern === "hatch") {
			svgElement(element, "path", { d: "M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6", ...line });
		} else if (pattern === "lines") {
			svgElement(element, "path", { d: "M0,4 L8,4", ...line });
		} else if (pattern === "dots") {
			svgElement(element, "circle", { cx: 4, cy: 4, r: 1, fill: "currentColor" });
		}
		return id;
	}

	private drawFill(points: readonly DiagramPoint[], pattern: FillPattern): void {
		const screen = points.map((point) => this.toScreen(point));
		for (const point of screen) this.include(point);
		const attrs: Record<string, string | number> = { points: pointsText(screen), stroke: "none" };
		if (pattern === "grey") {
			attrs.fill = "currentColor";
			attrs["fill-opacity"] = 0.18;
		} else {
			attrs.fill = `url(#${this.patternId(pattern)})`;
		}
		svgElement(this.group, "polygon", attrs);
	}

	private drawArrowShape(from: DiagramPoint, to: DiagramPoint, label: ShapeLabel | null): void {
		const start = this.toScreen(from);
		const end = this.toScreen(to);
		this.arrow(start, end);
		if (label === null) return;
		const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
		if (label.placement !== null) {
			this.labels.push({ line: this.currentLine, text: label.text, spots: [{ anchor: middle, placement: label.placement }] });
			return;
		}
		const direction = { x: end.x - start.x, y: end.y - start.y };
		let sides: Placement[] = ["above", "below"];
		if (Math.abs(direction.y) > Math.abs(direction.x)) sides = ["right", "left"];
		this.labels.push({
			line: this.currentLine,
			text: label.text,
			spots: [
				{ anchor: end, placement: placementFromVector(direction) },
				{ anchor: middle, placement: sides[0] ?? "above" },
				{ anchor: middle, placement: sides[1] ?? "below" },
			],
		});
	}

	private drawMoment(centre: DiagramPoint, radius: number, clockwise: boolean, label: ShapeLabel | null): void {
		const middle = this.toScreen(centre);
		const size = radius * this.scale;
		let start = (-60 * Math.PI) / 180;
		let end = (210 * Math.PI) / 180;
		if (clockwise) {
			start = (240 * Math.PI) / 180;
			end = (-30 * Math.PI) / 180;
		}
		this.polyline(this.arcPoints(middle, size, start, end), { thick: false, dashed: false }, false);
		const tip = { x: middle.x + size * Math.cos(end), y: middle.y - size * Math.sin(end) };
		let direction = { x: -Math.sin(end), y: -Math.cos(end) };
		if (clockwise) direction = { x: Math.sin(end), y: Math.cos(end) };
		this.arrowHead(tip, direction);
		this.requestLabel(label, { x: middle.x, y: middle.y - size }, "above");
	}

	private drawDistributed(shape: Extract<DiagramShape, { kind: "distributed" }>): void {
		const start = this.toScreen(shape.from);
		const end = this.toScreen(shape.to);
		const push = placementVector(directionPlacement(shape.direction));
		const span = Math.hypot(end.x - start.x, end.y - start.y);
		const count = Math.max(2, Math.floor(span / DISTRIBUTED_SPACING) + 1);
		const tails: Vector[] = [];
		for (let index = 0; index < count; index++) {
			const t = index / (count - 1);
			const head = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
			const length = (shape.startLength + (shape.endLength - shape.startLength) * t) * this.scale;
			const tail = { x: head.x - push.x * length, y: head.y - push.y * length };
			tails.push(tail);
			if (length > 0.5) this.arrow(tail, head);
		}
		const firstTail = tails[0];
		const lastTail = tails[tails.length - 1];
		if (firstTail === undefined || lastTail === undefined) return;
		this.polyline([firstTail, lastTail], { thick: false, dashed: false }, false);
		if (shape.label === null) return;
		const middle = { x: (firstTail.x + lastTail.x) / 2, y: (firstTail.y + lastTail.y) / 2 };
		const placement = shape.label.placement ?? placementFromVector({ x: -push.x, y: -push.y });
		this.labels.push({ line: this.currentLine, text: shape.label.text, spots: [{ anchor: middle, placement }] });
	}

	private sideNormal(from: Vector, to: Vector, side: Placement): Vector {
		const along = unit({ x: to.x - from.x, y: to.y - from.y });
		const normal = { x: -along.y, y: along.x };
		const wanted = placementVector(side);
		if (normal.x * wanted.x + normal.y * wanted.y < 0) return { x: -normal.x, y: -normal.y };
		return normal;
	}

	private drawDimension(from: DiagramPoint, to: DiagramPoint, side: Placement | null, label: ShapeLabel | null): void {
		const a = this.toScreen(from);
		const b = this.toScreen(to);
		const chosenSide = side ?? defaultSide(a, b);
		const normal = this.sideNormal(a, b, chosenSide);
		const offsetA = { x: a.x + normal.x * DIMENSION_OFFSET, y: a.y + normal.y * DIMENSION_OFFSET };
		const offsetB = { x: b.x + normal.x * DIMENSION_OFFSET, y: b.y + normal.y * DIMENSION_OFFSET };
		const plain = { thick: false, dashed: false };
		const reach = DIMENSION_OFFSET + 5;
		this.polyline([{ x: a.x + normal.x * 3, y: a.y + normal.y * 3 }, { x: a.x + normal.x * reach, y: a.y + normal.y * reach }], plain, false);
		this.polyline([{ x: b.x + normal.x * 3, y: b.y + normal.y * 3 }, { x: b.x + normal.x * reach, y: b.y + normal.y * reach }], plain, false);
		const middle = { x: (offsetA.x + offsetB.x) / 2, y: (offsetA.y + offsetB.y) / 2 };
		this.arrow(middle, offsetA);
		this.arrow(middle, offsetB);
		if (label === null) return;
		this.labels.push({ line: this.currentLine, text: label.text, spots: [{ anchor: middle, placement: chosenSide }] });
	}

	private drawAngle(first: DiagramPoint, vertex: DiagramPoint, second: DiagramPoint, label: ShapeLabel | null): void {
		const corner = this.toScreen(vertex);
		const a = this.toScreen(first);
		const b = this.toScreen(second);
		const startAngle = Math.atan2(-(a.y - corner.y), a.x - corner.x);
		const endAngle = Math.atan2(-(b.y - corner.y), b.x - corner.x);
		let sweep = endAngle - startAngle;
		while (sweep > Math.PI) sweep -= Math.PI * 2;
		while (sweep < -Math.PI) sweep += Math.PI * 2;
		this.polyline(this.arcPoints(corner, ANGLE_RADIUS, startAngle, startAngle + sweep), { thick: false, dashed: false }, false);
		if (label === null) return;
		const halfway = startAngle + sweep / 2;
		const outward = { x: Math.cos(halfway), y: -Math.sin(halfway) };
		const anchor = { x: corner.x + outward.x * ANGLE_RADIUS, y: corner.y + outward.y * ANGLE_RADIUS };
		const placement = label.placement ?? placementFromVector(outward);
		this.labels.push({ line: this.currentLine, text: label.text, spots: [{ anchor, placement }] });
	}

	private drawGround(from: DiagramPoint, to: DiagramPoint, side: Placement | null): void {
		const a = this.toScreen(from);
		const b = this.toScreen(to);
		const normal = this.sideNormal(a, b, side ?? "below");
		const along = unit({ x: b.x - a.x, y: b.y - a.y });
		const plain = { thick: false, dashed: false };
		this.polyline([a, b], { thick: true, dashed: false }, false);
		const span = Math.hypot(b.x - a.x, b.y - a.y);
		for (let distance = GROUND_SPACING / 2; distance <= span; distance += GROUND_SPACING) {
			const start = { x: a.x + along.x * distance, y: a.y + along.y * distance };
			const end = {
				x: start.x + normal.x * GROUND_DEPTH - along.x * GROUND_DEPTH,
				y: start.y + normal.y * GROUND_DEPTH - along.y * GROUND_DEPTH,
			};
			this.polyline([start, end], plain, false);
		}
	}

	private drawConnectedSymbol(shape: Extract<DiagramShape, { kind: "connected-symbol" }>): void {
		const symbol = CONNECTED_SYMBOLS.get(shape.symbol);
		if (symbol === undefined) return;
		const middle = { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 };
		const angle = (Math.atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x) * 180) / Math.PI;
		const bodyStart = placeLocal(middle, angle, shape.size, [-symbol.halfLength, 0]);
		const bodyEnd = placeLocal(middle, angle, shape.size, [symbol.halfLength, 0]);
		const plain = { thick: false, dashed: false };
		this.polyline([this.toScreen(shape.from), this.toScreen(bodyStart)], plain, false);
		this.polyline([this.toScreen(bodyEnd), this.toScreen(shape.to)], plain, false);
		this.drawSymbolParts(symbol.parts, middle, angle, shape.size);
		if (shape.label === null) return;

		const centre = this.toScreen(middle);
		const along = unit({ x: this.toScreen(bodyEnd).x - centre.x, y: this.toScreen(bodyEnd).y - centre.y });
		const across = { x: -along.y, y: along.x };
		const halfLength = symbol.halfLength * shape.size * this.scale;
		const halfHeight = symbol.halfHeight * shape.size * this.scale;
		const sideAnchor = (placement: Placement): Vector => {
			const toward = placementVector(placement);
			const reachAlong = Math.abs(along.x * toward.x + along.y * toward.y) * halfLength;
			const reachAcross = Math.abs(across.x * toward.x + across.y * toward.y) * halfHeight;
			const reach = reachAlong + reachAcross;
			return { x: centre.x + toward.x * reach, y: centre.y + toward.y * reach };
		};

		if (shape.label.placement !== null) {
			const placement = shape.label.placement;
			this.labels.push({ line: this.currentLine, text: shape.label.text, spots: [{ anchor: sideAnchor(placement), placement }] });
			return;
		}
		const upSide = this.toScreen(placeLocal(middle, angle, 1, [0, 1]));
		const primary = placementFromVector({ x: upSide.x - centre.x, y: upSide.y - centre.y });
		const secondary = oppositePlacement(primary);
		this.labels.push({
			line: this.currentLine,
			text: shape.label.text,
			spots: [
				{ anchor: sideAnchor(primary), placement: primary },
				{ anchor: sideAnchor(secondary), placement: secondary },
			],
		});
	}

	private drawPlacedSymbol(name: string, at: DiagramPoint, angle: number, size: number, label: ShapeLabel | null): void {
		const symbol = PLACED_SYMBOLS.get(name);
		if (symbol === undefined) return;
		this.drawSymbolParts(symbol.parts, at, angle, size);
		this.drawSymbolLabel(label, at, angle, size, symbol.label);
	}

	private drawNamedSymbol(name: string, at: DiagramPoint, angle: number, size: number, label: ShapeLabel | null): void {
		const symbol = NAMED_SYMBOLS.get(name);
		if (symbol === undefined) return;
		this.drawSymbolParts(symbol.parts, at, angle, size);
		this.drawSymbolLabel(label, at, angle, size, symbol.label);
	}

	private drawSymbolLabel(label: ShapeLabel | null, origin: DiagramPoint, angle: number, size: number, local: LocalPoint): void {
		if (label === null) return;
		const centre = this.toScreen(origin);
		const anchor = this.toScreen(placeLocal(origin, angle, size, local));
		const outward = { x: anchor.x - centre.x, y: anchor.y - centre.y };
		let fallback: Placement = "above";
		if (Math.hypot(outward.x, outward.y) > 0.001) fallback = placementFromVector(outward);
		this.requestLabel(label, anchor, fallback);
	}

	private drawSymbolParts(parts: readonly SymbolPart[], origin: DiagramPoint, angle: number, size: number): void {
		const place = (local: LocalPoint): Vector => this.toScreen(placeLocal(origin, angle, size, local));
		for (const part of parts) {
			if (part.type === "line") {
				this.drawSymbolLine(part.points.map(place), SYMBOL_STROKES[part.stroke]);
			} else if (part.type === "polygon") {
				this.drawSymbolPolygon(part.points.map(place), part.filled);
			} else if (part.type === "circle") {
				this.drawSymbolCircle(place(part.centre), part.radius * size * this.scale, part.style);
			} else if (part.type === "arc") {
				const points: Vector[] = [];
				for (let index = 0; index <= ARC_SEGMENTS; index++) {
					const degrees = part.start + ((part.end - part.start) * index) / ARC_SEGMENTS;
					const radians = (degrees * Math.PI) / 180;
					points.push(place([part.centre[0] + part.radius * Math.cos(radians), part.centre[1] + part.radius * Math.sin(radians)]));
				}
				this.polyline(points, { thick: false, dashed: false }, false);
			} else {
				const at = place(part.at);
				this.writeText(at.x, at.y, "middle", part.text, SYMBOL_FONT_SIZE, this.currentLine);
			}
		}
	}

	private drawSymbolLine(points: readonly Vector[], width: number): void {
		for (const point of points) this.include(point);
		this.recordPath(points, false);
		svgElement(this.group, "polyline", {
			points: pointsText(points),
			fill: "none",
			stroke: "currentColor",
			"stroke-width": width,
			"stroke-linejoin": "round",
			"stroke-linecap": "round",
		});
	}

	private drawSymbolPolygon(points: readonly Vector[], filled: boolean): void {
		for (const point of points) this.include(point);
		this.recordPath(points, true);
		const attrs: Record<string, string | number> = { points: pointsText(points), "stroke-linejoin": "round" };
		if (filled) {
			attrs.fill = "currentColor";
			attrs.stroke = "none";
		} else {
			attrs.fill = "none";
			attrs.stroke = "currentColor";
			attrs["stroke-width"] = STROKE;
		}
		svgElement(this.group, "polygon", attrs);
	}

	private drawSymbolCircle(centre: Vector, radius: number, style: "outline" | "filled" | "knockout"): void {
		this.include({ x: centre.x - radius, y: centre.y - radius });
		this.include({ x: centre.x + radius, y: centre.y + radius });
		this.recordCircle(centre, radius);
		const attrs: Record<string, string | number> = { cx: round(centre.x), cy: round(centre.y), r: round(radius) };
		if (style === "filled") {
			attrs.fill = "currentColor";
			attrs.stroke = "none";
		} else {
			attrs.fill = "none";
			attrs.stroke = "currentColor";
			attrs["stroke-width"] = STROKE;
		}
		if (style === "knockout") attrs.class = "examiner-diagram-knockout";
		svgElement(this.group, "circle", attrs);
	}
}

export function addDiagramEditButton(container: HTMLElement, onEdit: () => void): void {
	container.addClass("examiner-diagram-editable");
	const button = container.createDiv({ cls: "examiner-diagram-edit clickable-icon", attr: { role: "button", "aria-label": "Edit diagram" } });
	setIcon(button, "pencil");
	button.addEventListener("pointerdown", (event) => event.stopPropagation());
	button.addEventListener("mousedown", (event) => event.stopPropagation());
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		onEdit();
	});
}
