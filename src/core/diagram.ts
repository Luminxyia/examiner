import { CONNECTED_SYMBOLS, NAMED_SYMBOLS, PLACED_SYMBOLS, type LocalPoint } from "./diagram-symbols";

export interface DiagramPoint {
	x: number;
	y: number;
}

export type Placement = "above" | "below" | "left" | "right";
export type FillPattern = "hatch" | "dots" | "lines" | "grey";
export type Direction = "up" | "down" | "left" | "right";

export interface ShapeLabel {
	text: string;
	placement: Placement | null;
}

export interface LineStyle {
	thick: boolean;
	dashed: boolean;
}

export type DiagramShape =
	| { kind: "line"; points: DiagramPoint[]; closed: boolean; style: LineStyle; label: ShapeLabel | null }
	| { kind: "rectangle"; from: DiagramPoint; to: DiagramPoint; style: LineStyle; label: ShapeLabel | null }
	| { kind: "circle"; centre: DiagramPoint; radius: number; style: LineStyle; label: ShapeLabel | null }
	| { kind: "arc"; centre: DiagramPoint; radius: number; start: number; end: number; style: LineStyle; label: ShapeLabel | null }
	| { kind: "fill"; points: DiagramPoint[]; pattern: FillPattern }
	| { kind: "arrow"; from: DiagramPoint; to: DiagramPoint; label: ShapeLabel | null }
	| { kind: "moment"; centre: DiagramPoint; radius: number; clockwise: boolean; label: ShapeLabel | null }
	| {
			kind: "distributed";
			from: DiagramPoint;
			to: DiagramPoint;
			direction: Direction;
			startLength: number;
			endLength: number;
			label: ShapeLabel | null;
	  }
	| { kind: "dimension"; from: DiagramPoint; to: DiagramPoint; side: Placement | null; label: ShapeLabel | null }
	| { kind: "angle"; first: DiagramPoint; vertex: DiagramPoint; second: DiagramPoint; label: ShapeLabel | null }
	| { kind: "ground"; from: DiagramPoint; to: DiagramPoint; side: Placement | null }
	| { kind: "label"; at: DiagramPoint; text: string; placement: Placement | null }
	| { kind: "wire"; points: DiagramPoint[] }
	| { kind: "connected-symbol"; symbol: string; from: DiagramPoint; to: DiagramPoint; size: number; label: ShapeLabel | null }
	| { kind: "placed-symbol"; symbol: string; at: DiagramPoint; angle: number; size: number; label: ShapeLabel | null }
	| {
			kind: "named-symbol";
			symbol: string;
			name: string;
			at: DiagramPoint;
			angle: number;
			size: number;
			terminals: DiagramPoint[];
			label: ShapeLabel | null;
	  };

export interface DiagramError {
	line: number;
	message: string;
}

export interface DiagramPointInfo {
	name: string;
	x: number;
	y: number;
	line: number;
}

export type OptionName = "thick" | "dashed" | "closed" | "turn" | "placement" | "label" | "angle" | "size";

export interface ShapeSource {
	line: number;
	command: string;
	optionStart: number;
	options: readonly OptionName[];
}

export interface Diagram {
	shapes: DiagramShape[];
	sources: ShapeSource[];
	points: DiagramPointInfo[];
	errors: DiagramError[];
}

export interface Token {
	text: string;
	quoted: boolean;
}

interface Options {
	thick: boolean;
	dashed: boolean;
	closed: boolean;
	clockwise: boolean | null;
	placement: Placement | null;
	label: string | null;
	angle: number;
	size: number;
}

const PLACEMENTS: readonly string[] = ["above", "below", "left", "right"];
const PATTERNS: readonly string[] = ["hatch", "dots", "lines", "grey"];
const DIRECTIONS: readonly string[] = ["up", "down", "left", "right"];
const RESERVED_NAMES: readonly string[] = [
	"point",
	"line",
	"rectangle",
	"circle",
	"arc",
	"fill",
	"arrow",
	"moment",
	"distributed",
	"dimension",
	"angle",
	"ground",
	"label",
	"wire",
	"size",
	"at",
	"from",
	"to",
	"with",
	"radius",
	"length",
	"thick",
	"dashed",
	"closed",
	"clockwise",
	"anticlockwise",
	...PLACEMENTS,
	...DIRECTIONS,
	...CONNECTED_SYMBOLS.keys(),
	...PLACED_SYMBOLS.keys(),
	...NAMED_SYMBOLS.keys(),
];
const POINT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const POINT_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z]+)?$/;
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

class LineError extends Error {}

class LineReader {
	private index = 0;
	optionStart = -1;
	allowedOptions: readonly OptionName[] = [];

	constructor(
		private readonly tokens: Token[],
		private readonly points: ReadonlyMap<string, DiagramPoint>,
	) {}

	atEnd(): boolean {
		return this.index >= this.tokens.length;
	}

	peek(): Token | null {
		const token = this.tokens[this.index];
		if (token === undefined) return null;
		return token;
	}

	next(what: string): Token {
		const token = this.tokens[this.index];
		if (token === undefined) throw new LineError(`Expected ${what} but the line ended.`);
		this.index++;
		return token;
	}

	nextIsWord(word: string): boolean {
		const token = this.peek();
		if (token === null || token.quoted) return false;
		return token.text === word;
	}

	expectWord(word: string): void {
		const token = this.next(`"${word}"`);
		if (token.quoted || token.text !== word) throw new LineError(`Expected "${word}" but found "${token.text}".`);
	}

	skipComma(): void {
		if (this.nextIsWord(",")) this.index++;
	}

	readNumber(what: string): number {
		const token = this.next(what);
		const text = token.text.replace(/[−–]/g, "-");
		if (token.quoted || !NUMBER_PATTERN.test(text)) throw new LineError(`Expected ${what} but found "${token.text}".`);
		return Number(text);
	}

	readName(): string {
		const token = this.next("a point name");
		if (token.quoted || !POINT_NAME_PATTERN.test(token.text)) {
			throw new LineError(`"${token.text}" is not a valid point name.`);
		}
		if (RESERVED_NAMES.includes(token.text)) throw new LineError(`"${token.text}" cannot be used as a point name.`);
		return token.text;
	}

	readPoint(): DiagramPoint {
		const token = this.next("a point name");
		const point = this.points.get(token.text);
		if (token.quoted || point === undefined) throw new LineError(`Point ${token.text} is not defined.`);
		return point;
	}

	nextIsPoint(): boolean {
		const token = this.peek();
		if (token === null || token.quoted) return false;
		return this.points.has(token.text);
	}

	readWordFrom(choices: readonly string[], what: string): string {
		const token = this.next(what);
		if (token.quoted || !choices.includes(token.text)) {
			throw new LineError(`Expected ${what} (${choices.join(", ")}) but found "${token.text}".`);
		}
		return token.text;
	}

	readText(): string {
		const token = this.next("text in quotes");
		if (!token.quoted) throw new LineError(`Expected text in quotes but found "${token.text}".`);
		return token.text;
	}

	readOptions(allowed: readonly OptionName[]): Options {
		this.optionStart = this.index;
		this.allowedOptions = allowed;
		const options: Options = { thick: false, dashed: false, closed: false, clockwise: null, placement: null, label: null, angle: 0, size: 1 };
		while (!this.atEnd()) {
			const token = this.next("an option");
			const word = token.text;
			if (token.quoted) throw new LineError(`Unexpected text "${word}". Put label before it.`);
			if (word === "thick" && allowed.includes("thick")) {
				options.thick = true;
			} else if (word === "dashed" && allowed.includes("dashed")) {
				options.dashed = true;
			} else if (word === "closed" && allowed.includes("closed")) {
				options.closed = true;
			} else if (word === "clockwise" && allowed.includes("turn")) {
				options.clockwise = true;
			} else if (word === "anticlockwise" && allowed.includes("turn")) {
				options.clockwise = false;
			} else if (PLACEMENTS.includes(word) && allowed.includes("placement")) {
				options.placement = word as Placement;
			} else if (word === "label" && allowed.includes("label")) {
				options.label = this.readText();
			} else if (word === "angle" && allowed.includes("angle")) {
				options.angle = this.readNumber("an angle");
			} else if (word === "size" && allowed.includes("size")) {
				options.size = this.readNumber("a size");
				if (options.size <= 0) throw new LineError(`Expected a size more than 0 but found ${options.size}.`);
			} else {
				throw new LineError(`"${word}" is not an option here.`);
			}
		}
		return options;
	}
}

export function tokenise(line: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < line.length) {
		const char = line.charAt(index);
		if (/\s/.test(char)) {
			index++;
			continue;
		}
		if (char === ",") {
			tokens.push({ text: ",", quoted: false });
			index++;
			continue;
		}
		if (char === '"') {
			const close = line.indexOf('"', index + 1);
			if (close === -1) throw new LineError("Text in quotes is missing its closing quote.");
			tokens.push({ text: line.slice(index + 1, close), quoted: true });
			index = close + 1;
			continue;
		}
		let end = index;
		while (end < line.length && !/[\s,"]/.test(line.charAt(end))) end++;
		tokens.push({ text: line.slice(index, end), quoted: false });
		index = end;
	}
	return tokens;
}

function shapeLabel(options: Options): ShapeLabel | null {
	if (options.label === null) return null;
	return { text: options.label, placement: options.placement };
}

function lineStyle(options: Options): LineStyle {
	return { thick: options.thick, dashed: options.dashed };
}

function readPointList(reader: LineReader, minimum: number, what: string): DiagramPoint[] {
	const points: DiagramPoint[] = [];
	while (reader.nextIsPoint()) {
		points.push(reader.readPoint());
	}
	if (points.length < minimum) {
		const token = reader.peek();
		if (token !== null && !token.quoted && POINT_REFERENCE_PATTERN.test(token.text) && !RESERVED_NAMES.includes(token.text)) {
			throw new LineError(`Point ${token.text} is not defined.`);
		}
		throw new LineError(`A ${what} needs at least ${minimum} points.`);
	}
	return points;
}

function readPointDefinition(reader: LineReader): { name: string; point: DiagramPoint } {
	const name = reader.readName();
	reader.expectWord("at");
	const x = reader.readNumber("an x position");
	reader.skipComma();
	const y = reader.readNumber("a y position");
	if (!reader.atEnd()) throw new LineError(`Unexpected "${reader.next("").text}" after the position.`);
	return { name, point: { x, y } };
}

function readShape(command: string, reader: LineReader): DiagramShape {
	switch (command) {
		case "line": {
			const points = readPointList(reader, 2, "line");
			const options = reader.readOptions(["thick", "dashed", "closed", "placement", "label"]);
			return { kind: "line", points, closed: options.closed, style: lineStyle(options), label: shapeLabel(options) };
		}
		case "rectangle": {
			const from = reader.readPoint();
			const to = reader.readPoint();
			const options = reader.readOptions(["thick", "dashed", "placement", "label"]);
			return { kind: "rectangle", from, to, style: lineStyle(options), label: shapeLabel(options) };
		}
		case "circle": {
			reader.expectWord("at");
			const centre = reader.readPoint();
			reader.expectWord("radius");
			const radius = readPositive(reader, "a radius");
			const options = reader.readOptions(["thick", "dashed", "placement", "label"]);
			return { kind: "circle", centre, radius, style: lineStyle(options), label: shapeLabel(options) };
		}
		case "arc": {
			reader.expectWord("at");
			const centre = reader.readPoint();
			reader.expectWord("radius");
			const radius = readPositive(reader, "a radius");
			reader.expectWord("from");
			const start = reader.readNumber("a start angle");
			reader.expectWord("to");
			const end = reader.readNumber("an end angle");
			const options = reader.readOptions(["thick", "dashed", "placement", "label"]);
			return { kind: "arc", centre, radius, start, end, style: lineStyle(options), label: shapeLabel(options) };
		}
		case "fill": {
			const points = readPointList(reader, 3, "fill");
			reader.expectWord("with");
			const pattern = reader.readWordFrom(PATTERNS, "a fill pattern") as FillPattern;
			reader.readOptions([]);
			return { kind: "fill", points, pattern };
		}
		case "arrow":
			return readArrow(reader);
		case "moment": {
			reader.expectWord("at");
			const centre = reader.readPoint();
			reader.expectWord("radius");
			const radius = readPositive(reader, "a radius");
			const options = reader.readOptions(["turn", "placement", "label"]);
			if (options.clockwise === null) throw new LineError("A moment needs clockwise or anticlockwise.");
			return { kind: "moment", centre, radius, clockwise: options.clockwise, label: shapeLabel(options) };
		}
		case "distributed": {
			reader.expectWord("from");
			const from = reader.readPoint();
			reader.expectWord("to");
			const to = reader.readPoint();
			const direction = reader.readWordFrom(DIRECTIONS, "a direction") as Direction;
			reader.expectWord("length");
			const startLength = readNotNegative(reader, "a length");
			let endLength = startLength;
			if (reader.nextIsWord("to")) {
				reader.expectWord("to");
				endLength = readNotNegative(reader, "an end length");
			}
			if (startLength === 0 && endLength === 0) throw new LineError("At least one length must be more than 0.");
			const options = reader.readOptions(["placement", "label"]);
			return { kind: "distributed", from, to, direction, startLength, endLength, label: shapeLabel(options) };
		}
		case "dimension": {
			const from = reader.readPoint();
			const to = reader.readPoint();
			const options = reader.readOptions(["placement", "label"]);
			return { kind: "dimension", from, to, side: options.placement, label: shapeLabel(options) };
		}
		case "angle": {
			const first = reader.readPoint();
			const vertex = reader.readPoint();
			const second = reader.readPoint();
			const options = reader.readOptions(["placement", "label"]);
			return { kind: "angle", first, vertex, second, label: shapeLabel(options) };
		}
		case "ground": {
			const from = reader.readPoint();
			const to = reader.readPoint();
			const options = reader.readOptions(["placement"]);
			return { kind: "ground", from, to, side: options.placement };
		}
		case "label": {
			const text = reader.readText();
			reader.expectWord("at");
			const at = reader.readPoint();
			const options = reader.readOptions(["placement"]);
			return { kind: "label", at, text, placement: options.placement };
		}
		case "wire": {
			const points = readPointList(reader, 2, "wire");
			reader.readOptions([]);
			return { kind: "wire", points };
		}
		default:
			return readSymbol(command, reader);
	}
}

function readSymbol(command: string, reader: LineReader): DiagramShape {
	const connected = CONNECTED_SYMBOLS.get(command);
	if (connected !== undefined) {
		reader.expectWord("from");
		const from = reader.readPoint();
		reader.expectWord("to");
		const to = reader.readPoint();
		const options = reader.readOptions(["size", "placement", "label"]);
		const needed = connected.halfLength * 2 * options.size;
		if (Math.hypot(to.x - from.x, to.y - from.y) < needed - 1e-9) {
			throw new LineError(`The points are too close for a ${command}. It needs a gap of at least ${needed}.`);
		}
		return { kind: "connected-symbol", symbol: command, from, to, size: options.size, label: shapeLabel(options) };
	}
	if (command === "pulley") {
		reader.expectWord("at");
		const at = reader.readPoint();
		reader.expectWord("radius");
		const radius = readPositive(reader, "a radius");
		const options = reader.readOptions(["placement", "label"]);
		return { kind: "placed-symbol", symbol: command, at, angle: 0, size: radius, label: shapeLabel(options) };
	}
	if (PLACED_SYMBOLS.has(command)) {
		reader.expectWord("at");
		const at = reader.readPoint();
		const options = reader.readOptions(["angle", "size", "placement", "label"]);
		return { kind: "placed-symbol", symbol: command, at, angle: options.angle, size: options.size, label: shapeLabel(options) };
	}
	throw new LineError(`"${command}" is not a diagram command.`);
}

export function placeLocal(origin: DiagramPoint, angle: number, size: number, local: LocalPoint): DiagramPoint {
	const radians = (angle * Math.PI) / 180;
	const x = local[0] * size;
	const y = local[1] * size;
	return {
		x: origin.x + x * Math.cos(radians) - y * Math.sin(radians),
		y: origin.y + x * Math.sin(radians) + y * Math.cos(radians),
	};
}

function readNamedSymbol(command: string, reader: LineReader): Extract<DiagramShape, { kind: "named-symbol" }> {
	const symbol = NAMED_SYMBOLS.get(command);
	if (symbol === undefined) throw new LineError(`"${command}" is not a diagram command.`);
	const name = reader.readName();
	reader.expectWord("at");
	const at = reader.readPoint();
	const options = reader.readOptions(["angle", "size", "placement", "label"]);
	const terminals = Object.values(symbol.terminals).map((local) => placeLocal(at, options.angle, options.size, local));
	return { kind: "named-symbol", symbol: command, name, at, angle: options.angle, size: options.size, terminals, label: shapeLabel(options) };
}

function pointKey(point: DiagramPoint): string {
	return `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
}

export function findJunctions(shapes: readonly DiagramShape[]): DiagramPoint[] {
	const counts = new Map<string, number>();
	const locations = new Map<string, DiagramPoint>();
	const terminalSymbols = new Set<string>();
	const connect = (point: DiagramPoint, amount: number) => {
		const key = pointKey(point);
		counts.set(key, (counts.get(key) ?? 0) + amount);
		locations.set(key, point);
	};

	for (const shape of shapes) {
		if (shape.kind === "wire") {
			shape.points.forEach((point, index) => {
				const isEnd = index === 0 || index === shape.points.length - 1;
				if (isEnd) connect(point, 1);
				else connect(point, 2);
			});
		} else if (shape.kind === "connected-symbol") {
			connect(shape.from, 1);
			connect(shape.to, 1);
		} else if (shape.kind === "named-symbol") {
			for (const terminal of shape.terminals) connect(terminal, 1);
		} else if (shape.kind === "placed-symbol") {
			const symbol = PLACED_SYMBOLS.get(shape.symbol);
			if (symbol !== undefined && symbol.connects) connect(shape.at, 1);
			if (shape.symbol === "terminal") terminalSymbols.add(pointKey(shape.at));
		}
	}

	const junctions: DiagramPoint[] = [];
	for (const [key, count] of counts) {
		if (count < 3 || terminalSymbols.has(key)) continue;
		const location = locations.get(key);
		if (location !== undefined) junctions.push(location);
	}
	return junctions;
}

function readArrow(reader: LineReader): DiagramShape {
	if (reader.nextIsWord("from")) {
		reader.expectWord("from");
		const from = reader.readPoint();
		reader.expectWord("to");
		const to = reader.readPoint();
		const options = reader.readOptions(["placement", "label"]);
		return { kind: "arrow", from, to, label: shapeLabel(options) };
	}
	reader.expectWord("at");
	const from = reader.readPoint();
	reader.expectWord("angle");
	const angle = reader.readNumber("an angle");
	reader.expectWord("length");
	const length = readPositive(reader, "a length");
	const radians = (angle * Math.PI) / 180;
	const to = { x: from.x + length * Math.cos(radians), y: from.y + length * Math.sin(radians) };
	const options = reader.readOptions(["placement", "label"]);
	return { kind: "arrow", from, to, label: shapeLabel(options) };
}

function readPositive(reader: LineReader, what: string): number {
	const value = reader.readNumber(what);
	if (value <= 0) throw new LineError(`Expected ${what} more than 0 but found ${value}.`);
	return value;
}

function readNotNegative(reader: LineReader, what: string): number {
	const value = reader.readNumber(what);
	if (value < 0) throw new LineError(`Expected ${what} of 0 or more but found ${value}.`);
	return value;
}

interface SourceLine {
	number: number;
	tokens: Token[];
}

export function parseDiagram(source: string): Diagram {
	const errors: DiagramError[] = [];
	const lines: SourceLine[] = [];
	source.split(/\r?\n/).forEach((text, index) => {
		const number = index + 1;
		try {
			const tokens = tokenise(text);
			if (tokens.length > 0) lines.push({ number, tokens });
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: number, message: error.message });
		}
	});

	const points = new Map<string, DiagramPoint>();
	const pointList: DiagramPointInfo[] = [];
	const otherLines: SourceLine[] = [];
	for (const line of lines) {
		const command = line.tokens[0];
		if (command === undefined || command.quoted || command.text !== "point") {
			otherLines.push(line);
			continue;
		}
		try {
			const reader = new LineReader(line.tokens.slice(1), points);
			const definition = readPointDefinition(reader);
			if (points.has(definition.name)) throw new LineError(`Point ${definition.name} is already defined.`);
			points.set(definition.name, definition.point);
			pointList.push({ name: definition.name, x: definition.point.x, y: definition.point.y, line: line.number });
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: line.number, message: error.message });
		}
	}

	const placed: { shape: DiagramShape; source: ShapeSource }[] = [];
	const shapeLines: SourceLine[] = [];
	const symbolNames = new Set<string>();
	for (const line of otherLines) {
		const command = line.tokens[0];
		if (command === undefined || command.quoted || !NAMED_SYMBOLS.has(command.text)) {
			shapeLines.push(line);
			continue;
		}
		try {
			const reader = new LineReader(line.tokens.slice(1), points);
			const shape = readNamedSymbol(command.text, reader);
			if (symbolNames.has(shape.name)) throw new LineError(`${shape.name} is already used by another symbol.`);
			symbolNames.add(shape.name);
			const symbol = NAMED_SYMBOLS.get(shape.symbol);
			const terminalNames = Object.keys(symbol?.terminals ?? {});
			terminalNames.forEach((terminal, index) => {
				const location = shape.terminals[index];
				if (location !== undefined) points.set(`${shape.name}.${terminal}`, location);
			});
			placed.push({ shape, source: shapeSource(line, command.text, reader) });
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: line.number, message: error.message });
		}
	}

	for (const line of shapeLines) {
		const command = line.tokens[0];
		try {
			if (command === undefined || command.quoted) throw new LineError("A line must start with a diagram command.");
			const reader = new LineReader(line.tokens.slice(1), points);
			const shape = readShape(command.text, reader);
			placed.push({ shape, source: shapeSource(line, command.text, reader) });
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: line.number, message: error.message });
		}
	}

	placed.sort((a, b) => a.source.line - b.source.line);
	errors.sort((a, b) => a.line - b.line);
	const shapes = placed.map((entry) => entry.shape);
	const sources = placed.map((entry) => entry.source);
	return { shapes, sources, points: pointList, errors };
}

function shapeSource(line: SourceLine, command: string, reader: LineReader): ShapeSource {
	let optionStart = line.tokens.length;
	if (reader.optionStart >= 0) optionStart = reader.optionStart + 1;
	return { line: line.number, command, optionStart, options: reader.allowedOptions };
}

export function isValidPointName(name: string): boolean {
	if (!POINT_NAME_PATTERN.test(name)) return false;
	return !RESERVED_NAMES.includes(name);
}

export function shapeAnchors(shape: DiagramShape): DiagramPoint[] {
	switch (shape.kind) {
		case "line":
		case "fill":
		case "wire":
			return shape.points;
		case "rectangle":
		case "arrow":
		case "dimension":
		case "ground":
		case "distributed":
		case "connected-symbol":
			return [shape.from, shape.to];
		case "circle":
		case "arc":
		case "moment":
			return [shape.centre];
		case "angle":
			return [shape.first, shape.vertex, shape.second];
		case "label":
		case "placed-symbol":
		case "named-symbol":
			return [shape.at];
	}
}
