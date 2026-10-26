export function roundToPlaces(value: number, places: number): number {
	if (!Number.isFinite(value)) return value;
	const [mantissa, exponent] = Math.abs(value).toExponential(14).split("e") as [string, string];
	const shifted = Number(`${mantissa}e${Number(exponent) + places}`);
	if (shifted >= 1e15) return Number(value.toPrecision(15));
	const rounded = Math.round(shifted);
	const result = Number(`${rounded}e-${places}`);
	return value < 0 && result !== 0 ? -result : result;
}

export function hasAtMostPlaces(value: number, places: number): boolean {
	return roundToPlaces(value, places) === roundToPlaces(value, 15);
}

export function formatNumber(value: number): string {
	if (value === 0) return "0";
	const text = String(Number(value.toPrecision(10)));
	return text.replace("e+", "e");
}

export function formatScientific(value: number): string {
	if (value === 0 || !Number.isFinite(value)) return formatNumber(value);
	const [mantissa, exponent] = Number(value.toPrecision(10)).toExponential().split("e") as [string, string];
	return `${mantissa} × 10^${Number(exponent)}`;
}

export function formatFixed(value: number, places: number): string {
	const rounded = roundToPlaces(value, places);
	return (rounded === 0 ? 0 : rounded).toFixed(places);
}

const NUMBER_INPUT_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const POWER_OF_TEN_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+))[*×xX·]10\^\(?([+-]?\d+)\)?$/;

export type NumberInput = { ok: true; value: number } | { ok: false; message: string };

export function parseNumberInput(text: string): NumberInput {
	const normalised = text.trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
	if (normalised === "") return { ok: false, message: "Enter a number." };
	if (/^[+-]?\d+,\d+$/.test(normalised)) {
		return { ok: false, message: "Use a full stop as the decimal separator, for example 3.5." };
	}
	const powerOfTen = POWER_OF_TEN_PATTERN.exec(normalised);
	const literal = powerOfTen ? `${powerOfTen[1] ?? ""}e${powerOfTen[2] ?? ""}` : normalised;
	if (!NUMBER_INPUT_PATTERN.test(literal)) {
		return { ok: false, message: `"${text.trim()}" is not a number.` };
	}
	const value = Number(literal);
	if (!Number.isFinite(value)) return { ok: false, message: "That number is too large." };
	return { ok: true, value };
}
