export type LocalPoint = [number, number];
export type SymbolStroke = "thin" | "normal" | "thick" | "heavy";

export type SymbolPart =
	| { type: "line"; points: LocalPoint[]; stroke: SymbolStroke }
	| { type: "polygon"; points: LocalPoint[]; filled: boolean }
	| { type: "circle"; centre: LocalPoint; radius: number; style: "outline" | "filled" | "knockout" }
	| { type: "arc"; centre: LocalPoint; radius: number; start: number; end: number }
	| { type: "text"; at: LocalPoint; text: string };

export interface ConnectedSymbol {
	halfLength: number;
	halfHeight: number;
	parts: SymbolPart[];
}

export interface PlacedSymbol {
	label: LocalPoint;
	connects: boolean;
	parts: SymbolPart[];
}

export interface NamedSymbol {
	label: LocalPoint;
	terminals: Record<string, LocalPoint>;
	parts: SymbolPart[];
}

function line(stroke: SymbolStroke, ...points: LocalPoint[]): SymbolPart {
	return { type: "line", points, stroke };
}

function outline(...points: LocalPoint[]): SymbolPart {
	return { type: "polygon", points, filled: false };
}

function solid(...points: LocalPoint[]): SymbolPart {
	return { type: "polygon", points, filled: true };
}

function box(left: number, bottom: number, right: number, top: number): SymbolPart {
	return outline([left, bottom], [right, bottom], [right, top], [left, top]);
}

function hatchBelow(left: number, right: number, y: number, step: number): SymbolPart[] {
	const parts: SymbolPart[] = [line("thick", [left, y], [right, y])];
	for (let x = left + 0.1; x <= right + 0.001; x += step) {
		parts.push(line("thin", [x, y], [x - 0.15, y - 0.175]));
	}
	return parts;
}

const RESISTOR_BODY = box(-0.5, -0.175, 0.5, 0.175);
const DIODE_BODY: SymbolPart[] = [outline([-0.3, 0.3], [-0.3, -0.3], [0.25, 0]), line("normal", [0.25, 0], [0.3, 0])];

const TRANSISTOR_BODY: SymbolPart[] = [
	{ type: "circle", centre: [-0.15, 0], radius: 0.5, style: "outline" },
	line("normal", [-1, 0], [-0.35, 0]),
	line("thick", [-0.35, 0.3], [-0.35, -0.3]),
	line("normal", [-0.35, 0.15], [0, 0.4], [0, 1]),
	line("normal", [-0.35, -0.15], [0, -0.4], [0, -1]),
];

const TRANSISTOR_TERMINALS: Record<string, LocalPoint> = { b: [-1, 0], c: [0, 1], e: [0, -1] };

export const CONNECTED_SYMBOLS: ReadonlyMap<string, ConnectedSymbol> = new Map<string, ConnectedSymbol>([
	["resistor", { halfLength: 0.5, halfHeight: 0.175, parts: [RESISTOR_BODY] }],
	[
		"variable-resistor",
		{
			halfLength: 0.5,
			halfHeight: 0.375,
			parts: [RESISTOR_BODY, line("normal", [-0.375, -0.375], [0.3025, 0.24]), solid([0.45, 0.375], [0.36, 0.175], [0.245, 0.305])],
		},
	],
	["capacitor", { halfLength: 0.1, halfHeight: 0.4, parts: [line("thick", [-0.1, 0.4], [-0.1, -0.4]), line("thick", [0.1, 0.4], [0.1, -0.4])] }],
	[
		"polarised-capacitor",
		{
			halfLength: 0.15,
			halfHeight: 0.4,
			parts: [box(-0.15, -0.4, -0.025, 0.4), line("thick", [0.15, 0.4], [0.15, -0.4]), { type: "text", at: [-0.4, 0.45], text: "+" }],
		},
	],
	[
		"inductor",
		{
			halfLength: 0.75,
			halfHeight: 0.1875,
			parts: [
				{ type: "arc", centre: [-0.5625, 0], radius: 0.1875, start: 180, end: 0 },
				{ type: "arc", centre: [-0.1875, 0], radius: 0.1875, start: 180, end: 0 },
				{ type: "arc", centre: [0.1875, 0], radius: 0.1875, start: 180, end: 0 },
				{ type: "arc", centre: [0.5625, 0], radius: 0.1875, start: 180, end: 0 },
			],
		},
	],
	["diode", { halfLength: 0.3, halfHeight: 0.3, parts: [...DIODE_BODY, line("normal", [0.25, 0.3], [0.25, -0.3])] }],
	["zener", { halfLength: 0.3, halfHeight: 0.4, parts: [...DIODE_BODY, line("normal", [0.15, 0.4], [0.25, 0.3], [0.25, -0.3], [0.35, -0.4])] }],
	[
		"led",
		{
			halfLength: 0.3,
			halfHeight: 0.65,
			parts: [
				...DIODE_BODY,
				line("normal", [0.25, 0.3], [0.25, -0.3]),
				line("normal", [-0.05, 0.4], [0.095, 0.545]),
				solid([0.2, 0.65], [0.1375, 0.5], [0.05, 0.5875]),
				line("normal", [0.15, 0.3], [0.295, 0.445]),
				solid([0.4, 0.55], [0.3375, 0.4], [0.25, 0.4875]),
			],
		},
	],
	[
		"cell",
		{
			halfLength: 0.125,
			halfHeight: 0.45,
			parts: [line("normal", [-0.125, 0.45], [-0.125, -0.45]), line("heavy", [0.125, 0.225], [0.125, -0.225]), { type: "text", at: [-0.4, 0.5], text: "+" }],
		},
	],
	[
		"voltage-source",
		{
			halfLength: 0.5,
			halfHeight: 0.5,
			parts: [{ type: "circle", centre: [0, 0], radius: 0.5, style: "outline" }, line("normal", [-0.5, 0], [0.5, 0])],
		},
	],
	[
		"current-source",
		{
			halfLength: 0.5,
			halfHeight: 0.5,
			parts: [{ type: "circle", centre: [0, 0], radius: 0.5, style: "outline" }, line("normal", [0, 0.5], [0, -0.5])],
		},
	],
	["switch", { halfLength: 0.4, halfHeight: 0.4, parts: [line("normal", [-0.4, 0], [0.35, 0.4])] }],
	[
		"lamp",
		{
			halfLength: 0.35,
			halfHeight: 0.35,
			parts: [
				{ type: "circle", centre: [0, 0], radius: 0.35, style: "outline" },
				line("normal", [-0.2475, 0.2475], [0.2475, -0.2475]),
				line("normal", [0.2475, 0.2475], [-0.2475, -0.2475]),
			],
		},
	],
	[
		"spring",
		{
			halfLength: 0.75,
			halfHeight: 0.25,
			parts: [
				line(
					"normal",
					[-0.75, 0],
					[-0.625, 0.25],
					[-0.375, -0.25],
					[-0.125, 0.25],
					[0.125, -0.25],
					[0.375, 0.25],
					[0.625, -0.25],
					[0.75, 0],
				),
			],
		},
	],
	[
		"damper",
		{
			halfLength: 0.3,
			halfHeight: 0.35,
			parts: [
				line("normal", [-0.3, 0.25], [-0.3, -0.25]),
				line("normal", [-0.55, 0.35], [0.3, 0.35], [0.3, -0.35], [-0.55, -0.35]),
			],
		},
	],
	["valve", { halfLength: 0.5, halfHeight: 0.3, parts: [outline([-0.5, 0.3], [-0.5, -0.3], [0, 0]), outline([0.5, 0.3], [0.5, -0.3], [0, 0])] }],
	["check-valve", { halfLength: 0.5, halfHeight: 0.3, parts: [outline([-0.5, 0.3], [-0.5, -0.3], [0, 0]), solid([0.5, 0.3], [0.5, -0.3], [0, 0])] }],
	[
		"pump",
		{
			halfLength: 0.5,
			halfHeight: 0.5,
			parts: [{ type: "circle", centre: [0, 0], radius: 0.5, style: "outline" }, outline([-0.225, 0.325], [-0.225, -0.325], [0.4, 0])],
		},
	],
]);

export const PLACED_SYMBOLS: ReadonlyMap<string, PlacedSymbol> = new Map<string, PlacedSymbol>([
	[
		"ground-symbol",
		{
			label: [0.45, -0.5],
			connects: true,
			parts: [line("normal", [0, 0], [0, -0.5]), ...hatchBelow(-0.4, 0.4, -0.5, 0.15)],
		},
	],
	[
		"pin-support",
		{
			label: [0, -0.85],
			connects: false,
			parts: [
				outline([0, 0], [-0.35, -0.65], [0.35, -0.65]),
				...hatchBelow(-0.55, 0.55, -0.65, 0.2),
				{ type: "circle", centre: [0, 0], radius: 0.075, style: "knockout" },
			],
		},
	],
	[
		"roller-support",
		{
			label: [0, -0.95],
			connects: false,
			parts: [
				outline([0, 0], [-0.3, -0.55], [0.3, -0.55]),
				{ type: "circle", centre: [-0.2, -0.6625], radius: 0.1125, style: "outline" },
				{ type: "circle", centre: [0.2, -0.6625], radius: 0.1125, style: "outline" },
				...hatchBelow(-0.55, 0.55, -0.775, 0.2),
				{ type: "circle", centre: [0, 0], radius: 0.075, style: "knockout" },
			],
		},
	],
	[
		"fixed-support",
		{
			label: [0, -0.8],
			connects: false,
			parts: [
				line("thick", [0, 0.7], [0, -0.7]),
				line("thin", [0, 0.6], [-0.175, 0.425]),
				line("thin", [0, 0.4], [-0.175, 0.225]),
				line("thin", [0, 0.2], [-0.175, 0.025]),
				line("thin", [0, 0], [-0.175, -0.175]),
				line("thin", [0, -0.2], [-0.175, -0.375]),
				line("thin", [0, -0.4], [-0.175, -0.575]),
				line("thin", [0, -0.6], [-0.175, -0.775]),
			],
		},
	],
	["hinge", { label: [0, 0.15], connects: false, parts: [{ type: "circle", centre: [0, 0], radius: 0.125, style: "knockout" }] }],
	["terminal", { label: [0, 0.15], connects: true, parts: [{ type: "circle", centre: [0, 0], radius: 0.125, style: "knockout" }] }],
	[
		"pulley",
		{
			label: [0, 1],
			connects: false,
			parts: [
				{ type: "circle", centre: [0, 0], radius: 1, style: "outline" },
				{ type: "circle", centre: [0, 0], radius: 0.08, style: "filled" },
			],
		},
	],
]);

export const NAMED_SYMBOLS: ReadonlyMap<string, NamedSymbol> = new Map<string, NamedSymbol>([
	[
		"npn",
		{
			label: [-0.55, -0.5],
			terminals: TRANSISTOR_TERMINALS,
			parts: [...TRANSISTOR_BODY, solid([-0.0525, -0.3625], [-0.1717, -0.1852], [-0.2589, -0.3074])],
		},
	],
	[
		"pnp",
		{
			label: [-0.55, -0.5],
			terminals: TRANSISTOR_TERMINALS,
			parts: [...TRANSISTOR_BODY, solid([-0.245, -0.225], [-0.0386, -0.2801], [-0.1258, -0.4023])],
		},
	],
	[
		"potentiometer",
		{
			label: [0, -0.175],
			terminals: { a: [-1, 0], b: [1, 0], w: [0, 1] },
			parts: [
				RESISTOR_BODY,
				line("normal", [-1, 0], [-0.5, 0]),
				line("normal", [0.5, 0], [1, 0]),
				line("normal", [0, 1], [0, 0.375]),
				solid([0, 0.175], [-0.0875, 0.375], [0.0875, 0.375]),
			],
		},
	],
	[
		"opamp",
		{
			label: [0, -0.75],
			terminals: { minus: [-1, 0.5], plus: [-1, -0.5], out: [1, 0] },
			parts: [
				box(-0.5, -0.75, 0.5, 0.75),
				line("normal", [-1, 0.5], [-0.5, 0.5]),
				line("normal", [-1, -0.5], [-0.5, -0.5]),
				line("normal", [0.5, 0], [1, 0]),
				{ type: "text", at: [0.05, 0.35], text: "▷ ∞" },
				{ type: "text", at: [-0.35, 0.5], text: "−" },
				{ type: "text", at: [-0.35, -0.5], text: "+" },
			],
		},
	],
]);
