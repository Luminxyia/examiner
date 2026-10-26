export interface Point {
	x: number;
	y: number;
}

function monotoneTangents(points: readonly Point[]): number[] {
	const count = points.length;
	const slopes: number[] = [];
	for (let i = 0; i < count - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		slopes.push((b.y - a.y) / (b.x - a.x));
	}
	const tangents: number[] = new Array<number>(count).fill(0);
	tangents[0] = slopes[0] ?? 0;
	tangents[count - 1] = slopes[count - 2] ?? 0;
	for (let i = 1; i < count - 1; i++) {
		const before = slopes[i - 1];
		const after = slopes[i];
		tangents[i] = before * after <= 0 ? 0 : (before + after) / 2;
	}
	for (let i = 0; i < count - 1; i++) {
		const slope = slopes[i];
		if (slope === 0) {
			tangents[i] = 0;
			tangents[i + 1] = 0;
			continue;
		}
		const alpha = tangents[i] / slope;
		const beta = tangents[i + 1] / slope;
		const length = alpha * alpha + beta * beta;
		if (length > 9) {
			const scale = 3 / Math.sqrt(length);
			tangents[i] = scale * alpha * slope;
			tangents[i + 1] = scale * beta * slope;
		}
	}
	return tangents;
}

export function monotonePath(points: readonly Point[]): string {
	if (points.length === 0) return "";
	const first = points[0];
	if (points.length === 1) return `M${first.x},${first.y}`;
	const tangents = monotoneTangents(points);
	let path = `M${first.x},${first.y}`;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const third = (b.x - a.x) / 3;
		const c1 = { x: a.x + third, y: a.y + tangents[i] * third };
		const c2 = { x: b.x - third, y: b.y - tangents[i + 1] * third };
		path += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
	}
	return path;
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
