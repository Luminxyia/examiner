export interface Point {
	x: number;
	y: number;
}

export function linePath(points: readonly Point[]): string {
	return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
}

export function sampleSeries(values: readonly number[], fraction: number): number | undefined {
	if (values.length === 0) return undefined;
	if (values.length === 1) return values[0];
	const position = Math.min(1, Math.max(0, fraction)) * (values.length - 1);
	const lower = Math.floor(position);
	const upper = Math.min(values.length - 1, lower + 1);
	const weight = position - lower;
	return values[lower] * (1 - weight) + values[upper] * weight;
}

export function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}
