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
	| { kind: "label"; at: DiagramPoint; text: string; placement: Placement | null };

export interface DiagramError {
	line: number;
	message: string;
}

export interface Diagram {
	shapes: DiagramShape[];
	errors: DiagramError[];
}

interface Token {
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
}

type OptionName = "thick" | "dashed" | "closed" | "turn" | "placement" | "label";

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
];
const POINT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

class LineError extends Error {}

class LineReader {
	private index = 0;

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
		const options: Options = { thick: false, dashed: false, closed: false, clockwise: null, placement: null, label: null };
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
		if (token !== null && !token.quoted && POINT_NAME_PATTERN.test(token.text) && !RESERVED_NAMES.includes(token.text)) {
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
		default:
			throw new LineError(`"${command}" is not a diagram command.`);
	}
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
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: line.number, message: error.message });
		}
	}

	const shapes: DiagramShape[] = [];
	for (const line of otherLines) {
		const command = line.tokens[0];
		try {
			if (command === undefined || command.quoted) throw new LineError("A line must start with a diagram command.");
			const reader = new LineReader(line.tokens.slice(1), points);
			shapes.push(readShape(command.text, reader));
		} catch (error) {
			if (!(error instanceof LineError)) throw error;
			errors.push({ line: line.number, message: error.message });
		}
	}

	errors.sort((a, b) => a.line - b.line);
	return { shapes, errors };
}
