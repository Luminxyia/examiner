import { parseDiagram, type DiagramPoint, type DiagramShape, type Direction, type FillPattern, type LineStyle, type Placement, type ShapeLabel } from "../core/diagram";

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

let diagramCount = 0;

export function renderDiagram(container: HTMLElement, source: string): void {
	container.empty();
	const diagram = parseDiagram(source);
	if (diagram.errors.length > 0) {
		const list = container.createDiv({ cls: "examiner-diagram-errors examiner-error-text" });
		for (const error of diagram.errors) list.createDiv({ text: `Line ${error.line}: ${error.message}` });
		return;
	}
	if (diagram.shapes.length === 0) return;
	diagramCount++;
	const drawing = new Drawing(container, `examiner-diagram-${diagramCount}`, diagram.shapes);
	for (const shape of diagram.shapes) drawing.draw(shape);
	drawing.finish();
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

function pointsText(points: readonly Vector[]): string {
	return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function shapeExtent(shape: DiagramShape): DiagramPoint[] {
	switch (shape.kind) {
		case "line":
		case "fill":
			return shape.points;
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
	private readonly scale: number;
	private readonly bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	private readonly patterns = new Set<FillPattern>();

	constructor(
		container: HTMLElement,
		private readonly id: string,
		shapes: readonly DiagramShape[],
	) {
		this.scale = chooseScale(shapes);
		this.svg = svgElement(container.createDiv({ cls: "examiner-diagram" }), "svg", { role: "img" });
		this.defs = svgElement(this.svg, "defs", {});
	}

	finish(): void {
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

	draw(shape: DiagramShape): void {
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
				this.drawText(this.toScreen(shape.at), shape.text, shape.placement ?? "above");
				break;
		}
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
		const tag = closed ? "polygon" : "polyline";
		svgElement(this.svg, tag, { points: pointsText(points), ...this.strokeAttrs(style) });
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
		svgElement(this.svg, "polygon", { points: pointsText(corners), fill: "currentColor", stroke: "none" });
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

	private drawText(anchor: Vector, text: string, placement: Placement | "centre"): void {
		if (text === "") return;
		const width = text.length * FONT_SIZE * 0.6;
		let x = anchor.x;
		let y = anchor.y;
		let textAnchor = "middle";
		if (placement === "above") {
			y = anchor.y - LABEL_GAP - FONT_SIZE / 2;
		} else if (placement === "below") {
			y = anchor.y + LABEL_GAP + FONT_SIZE / 2;
		} else if (placement === "left") {
			x = anchor.x - LABEL_GAP;
			textAnchor = "end";
		} else if (placement === "right") {
			x = anchor.x + LABEL_GAP;
			textAnchor = "start";
		}
		let left = x - width / 2;
		if (textAnchor === "end") left = x - width;
		if (textAnchor === "start") left = x;
		this.include({ x: left, y: y - FONT_SIZE / 2 });
		this.include({ x: left + width, y: y + FONT_SIZE / 2 });
		const element = svgElement(this.svg, "text", {
			x: round(x),
			y: round(y),
			"text-anchor": textAnchor,
			"dominant-baseline": "central",
			"font-size": FONT_SIZE,
			fill: "currentColor",
		});
		element.textContent = text;
	}

	private drawShapeLabel(label: ShapeLabel | null, anchor: Vector, fallback: Placement | "centre"): void {
		if (label === null) return;
		this.drawText(anchor, label.text, label.placement ?? fallback);
	}

	private drawLine(points: readonly DiagramPoint[], closed: boolean, style: LineStyle, label: ShapeLabel | null): void {
		const screen = points.map((point) => this.toScreen(point));
		this.polyline(screen, style, closed);
		const first = screen[0];
		const second = screen[1];
		if (first === undefined || second === undefined) return;
		const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
		this.drawShapeLabel(label, middle, "above");
	}

	private drawRectangle(from: DiagramPoint, to: DiagramPoint, style: LineStyle, label: ShapeLabel | null): void {
		const a = this.toScreen(from);
		const b = this.toScreen(to);
		const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
		this.polyline(corners, style, true);
		const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		this.drawShapeLabel(label, centre, "centre");
	}

	private drawCircle(centre: DiagramPoint, radius: number, style: LineStyle, label: ShapeLabel | null): void {
		const middle = this.toScreen(centre);
		const size = radius * this.scale;
		this.include({ x: middle.x - size, y: middle.y - size });
		this.include({ x: middle.x + size, y: middle.y + size });
		svgElement(this.svg, "circle", { cx: round(middle.x), cy: round(middle.y), r: round(size), ...this.strokeAttrs(style) });
		this.drawShapeLabel(label, middle, "centre");
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
		this.drawShapeLabel(label, anchor, placementFromVector(outward));
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
		svgElement(this.svg, "polygon", attrs);
	}

	private drawArrowShape(from: DiagramPoint, to: DiagramPoint, label: ShapeLabel | null): void {
		const start = this.toScreen(from);
		const end = this.toScreen(to);
		this.arrow(start, end);
		const direction = { x: end.x - start.x, y: end.y - start.y };
		this.drawShapeLabel(label, end, placementFromVector(direction));
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
		this.drawShapeLabel(label, { x: middle.x, y: middle.y - size }, "above");
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
		const middle = { x: (firstTail.x + lastTail.x) / 2, y: (firstTail.y + lastTail.y) / 2 };
		this.drawShapeLabel(shape.label, middle, placementFromVector({ x: -push.x, y: -push.y }));
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
		this.drawShapeLabel(label, middle, chosenSide);
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
		const halfway = startAngle + sweep / 2;
		const outward = { x: Math.cos(halfway), y: -Math.sin(halfway) };
		const anchor = { x: corner.x + outward.x * ANGLE_RADIUS, y: corner.y + outward.y * ANGLE_RADIUS };
		this.drawShapeLabel(label, anchor, placementFromVector(outward));
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
