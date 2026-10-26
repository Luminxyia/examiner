import { setTooltip } from "obsidian";
import { easeOutCubic, monotonePath, sampleSeries } from "../core/curve";
import { addLocalDays, formatDuration, localDayKey, startOfLocalDay, type NumberedAttempt } from "../core/statistics";
import { formatDateTime, formatMarks, formatPercent, formatScore, type Tone } from "./shared";

export interface OutcomeSegment {
	label: string;
	value: number;
	tone: Tone;
}

export function renderOutcomeBar(parent: HTMLElement, segments: readonly OutcomeSegment[]): void {
	const total = segments.reduce((sum, segment) => sum + segment.value, 0);
	const bar = parent.createDiv({ cls: "examiner-outcome-bar", attr: { role: "img" } });
	bar.setAttribute("aria-label", segments.map((segment) => `${segment.label}: ${segment.value}`).join(", "));
	for (const segment of segments) {
		if (segment.value === 0 || total === 0) continue;
		const part = bar.createDiv({ cls: `examiner-outcome-segment examiner-tone-${segment.tone}` });
		part.setCssProps({ "--examiner-share": String(segment.value) });
		setTooltip(part, `${segment.label}: ${segment.value} (${formatPercent((segment.value / total) * 100)})`);
	}

	const legend = parent.createDiv({ cls: "examiner-legend" });
	for (const segment of segments) {
		const item = legend.createDiv({ cls: `examiner-legend-item examiner-tone-${segment.tone}` });
		item.createSpan({ cls: "examiner-legend-dot" });
		item.createSpan({ cls: "examiner-legend-value", text: String(segment.value) });
		item.createSpan({ text: segment.label.toLowerCase() });
	}
}

export interface GradePoint {
	attemptNumber: number;
	percent: number;
	description: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
	const element = activeDocument.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
	parent.appendChild(element);
	return element;
}

export function gradePoints(history: readonly NumberedAttempt[]): GradePoint[] {
	return history.map((attempt) => ({
		attemptNumber: attempt.attemptNumber,
		percent: attempt.percent,
		description: `Attempt ${attempt.attemptNumber}: ${formatPercent(attempt.percent)}, ${formatScore(attempt.marks, attempt.maxMarks)} marks, ${formatDateTime(attempt.submittedAt)}`,
	}));
}

const CHART = { width: 560, height: 240, top: 12, right: 16, bottom: 34, left: 40 };
const PLOT_WIDTH = CHART.width - CHART.left - CHART.right;
const PLOT_HEIGHT = CHART.height - CHART.top - CHART.bottom;
const BASELINE = CHART.top + PLOT_HEIGHT;
const TRANSITION_MS = 320;

let chartCount = 0;

const chartY = (percent: number) => CHART.top + (1 - Math.min(100, Math.max(0, percent)) / 100) * PLOT_HEIGHT;
const chartX = (index: number, count: number) => CHART.left + (count === 1 ? PLOT_WIDTH / 2 : (index / (count - 1)) * PLOT_WIDTH);

export class GradeChart {
	private readonly chart: SVGSVGElement;
	private readonly area: SVGPathElement;
	private readonly aboveArea: SVGPathElement;
	private readonly belowArea: SVGPathElement;
	private readonly aboveClip: SVGRectElement;
	private readonly belowClip: SVGRectElement;
	private readonly line: SVGPathElement;
	private readonly labels: SVGGElement;
	private readonly passing: SVGGElement;
	private readonly passingLine: SVGLineElement;
	private readonly passingLabel: SVGTextElement;
	private readonly markers: SVGGElement;
	private shown: number[] = [];
	private frame = 0;

	private readonly figure: HTMLElement;
	private titleEl: HTMLElement | null = null;

	constructor(parent: HTMLElement) {
		const figure = parent.createDiv({ cls: "examiner-grade-chart" });
		this.figure = figure;
		this.chart = svg(figure, "svg", { viewBox: `0 0 ${CHART.width} ${CHART.height}`, role: "img" });
		const id = `examiner-grade-${++chartCount}`;
		const defs = svg(this.chart, "defs", {});
		this.aboveClip = svg(svg(defs, "clipPath", { id: `${id}-above` }), "rect", { x: 0, y: 0, width: CHART.width, height: 0 });
		this.belowClip = svg(svg(defs, "clipPath", { id: `${id}-below` }), "rect", { x: 0, y: 0, width: CHART.width, height: 0 });
		this.area = svg(this.chart, "path", { class: "examiner-grade-area" });
		this.aboveArea = svg(this.chart, "path", { class: "examiner-grade-area-above", "clip-path": `url(#${id}-above)` });
		this.belowArea = svg(this.chart, "path", { class: "examiner-grade-area-below", "clip-path": `url(#${id}-below)` });
		for (const tick of [0, 25, 50, 75, 100]) {
			svg(this.chart, "line", { class: "examiner-grade-grid", x1: CHART.left, x2: CHART.width - CHART.right, y1: chartY(tick), y2: chartY(tick) });
			svg(this.chart, "text", { class: "examiner-grade-tick", x: CHART.left - 8, y: chartY(tick), "text-anchor": "end", "dominant-baseline": "middle" }).textContent =
				`${tick}%`;
		}
		svg(this.chart, "text", { class: "examiner-grade-axis", x: CHART.left + PLOT_WIDTH / 2, y: CHART.height - 2, "text-anchor": "middle" }).textContent = "Attempt";
		this.labels = svg(this.chart, "g", {});
		this.passing = svg(this.chart, "g", { class: "examiner-grade-passing" });
		this.passingLine = svg(this.passing, "line", { x1: CHART.left, x2: CHART.width - CHART.right });
		this.passingLabel = svg(this.passing, "text", { x: CHART.width - CHART.right, "text-anchor": "end" });
		this.line = svg(this.chart, "path", { class: "examiner-grade-line" });
		this.markers = svg(this.chart, "g", {});
	}

	setTitle(title: string): void {
		if (!this.titleEl) {
			this.titleEl = createDiv({ cls: "examiner-grade-chart-title" });
			this.titleEl.setCssProps({
				"--examiner-plot-left": `${(CHART.left / CHART.width) * 100}%`,
				"--examiner-plot-right": `${(CHART.right / CHART.width) * 100}%`,
			});
		}

		if (!this.titleEl.isConnected) this.figure.prepend(this.titleEl);
		this.titleEl.setText(title);
		this.titleEl.setAttribute("title", title);
	}

	update(points: readonly GradePoint[], animate: boolean, passingPercent: number | null = null): void {

		window.cancelAnimationFrame(this.frame);
		this.passing.toggleClass("is-hidden", passingPercent === null);
		const passingY = passingPercent === null ? null : chartY(passingPercent);
		if (passingPercent !== null && passingY !== null) {
			const y = passingY;
			this.aboveClip.setAttribute("height", String(y));
			this.belowClip.setAttribute("y", String(y));
			this.belowClip.setAttribute("height", String(CHART.height - y));
			this.passingLine.setAttribute("y1", String(y));
			this.passingLine.setAttribute("y2", String(y));
			this.passingLabel.setAttribute("y", String(passingPercent > 90 ? y + 13 : y - 5));
			this.passingLabel.textContent = `Passing: ${passingPercent}%`;
		}
		const targets = points.map((point) => point.percent);
		const previous = this.shown;
		this.chart.setAttribute("aria-label", `Percentage grade for ${points.length} ${points.length === 1 ? "attempt" : "attempts"}, oldest first.`);

		this.labels.empty();
		const labelEvery = Math.max(1, Math.ceil(points.length / 12));
		points.forEach((point, index) => {
			if (index % labelEvery !== 0 && index !== points.length - 1) return;
			svg(this.labels, "text", { class: "examiner-grade-tick", x: chartX(index, points.length), y: CHART.height - CHART.bottom + 18, "text-anchor": "middle" }).textContent =
				String(point.attemptNumber);
		});

		this.markers.empty();
		const size = points.length > 40 ? 6 : 8;
		const squares = points.map((point) => {
			const square = svg(this.markers, "rect", { class: "examiner-grade-point", width: size, height: size });
			svg(square, "title", {}).textContent = point.description;
			return square;
		});

		const draw = (values: readonly number[]) => {
			this.shown = [...values];
			const coordinates = values.map((value, index) => ({ x: chartX(index, values.length), y: chartY(value) }));
			const curve = monotonePath(coordinates);
			const first = coordinates[0];
			const last = coordinates[coordinates.length - 1];
			const hasCurve = first !== undefined && last !== undefined && coordinates.length > 1;
			this.line.setAttribute("d", hasCurve ? curve : "");
			const closeAt = (y: number) => (hasCurve ? `${curve} L${last.x},${y} L${first.x},${y} Z` : "");
			this.area.setAttribute("d", passingY === null ? closeAt(BASELINE) : "");
			const band = passingY === null ? "" : closeAt(passingY);
			this.aboveArea.setAttribute("d", band);
			this.belowArea.setAttribute("d", band);
			coordinates.forEach((point, index) => {
				squares[index]?.setAttribute("x", String(point.x - size / 2));
				squares[index]?.setAttribute("y", String(point.y - size / 2));
			});
		};

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (!animate || reduceMotion || previous.length === 0 || targets.length === 0) {
			draw(targets);
			return;
		}
		const starts = targets.map((_, index) => sampleSeries(previous, targets.length === 1 ? 0.5 : index / (targets.length - 1)) ?? 0);
		const startTime = performance.now();
		const step = (now: number) => {
			const progress = easeOutCubic((now - startTime) / TRANSITION_MS);
			draw(starts.map((start, index) => start + ((targets[index]) - start) * progress));
			if (progress < 1) this.frame = window.requestAnimationFrame(step);
		};
		draw(starts);
		this.frame = window.requestAnimationFrame(step);
	}

	destroy(): void {
		window.cancelAnimationFrame(this.frame);
	}
}

const HEATMAP_LEVELS_MINUTES = [15, 30, 60];

function heatmapLevel(ms: number): number {
	if (ms <= 0) return 0;
	const minutes = ms / 60_000;
	return 1 + HEATMAP_LEVELS_MINUTES.filter((threshold) => minutes >= threshold).length;
}

export function renderStudyHeatmap(parent: HTMLElement, daily: ReadonlyMap<string, number>, today: Date): void {
	const rangeStart = addLocalDays(startOfLocalDay(today), -364);
	const weekStart = addLocalDays(rangeStart, -((rangeStart.getDay() + 6) % 7));
	const end = startOfLocalDay(today);
	const weeks = Math.floor((end.getTime() - weekStart.getTime()) / (7 * 86_400_000)) + 1;

	const wrapper = parent.createDiv({ cls: "examiner-heatmap" });
	const scroller = wrapper.createDiv({ cls: "examiner-heatmap-scroll" });
	const inner = scroller.createDiv({ cls: "examiner-heatmap-inner" });
	const grid = inner.createDiv({ cls: "examiner-heatmap-grid", attr: { role: "img" } });
	grid.setCssProps({ "--examiner-weeks": String(weeks) });
	let total = 0;
	let activeDays = 0;

	const months = grid.createDiv({ cls: "examiner-heatmap-months" });
	let lastMonth = -1;
	for (let week = 0; week < weeks; week++) {
		const date = addLocalDays(weekStart, week * 7);
		const label = months.createSpan();
		if (date.getMonth() !== lastMonth) {
			label.setText(date.toLocaleDateString(undefined, { month: "short" }));
			lastMonth = date.getMonth();
		}
	}

	const dayNames = grid.createDiv({ cls: "examiner-heatmap-days" });
	for (let day = 0; day < 7; day++) {
		const name = addLocalDays(weekStart, day).toLocaleDateString(undefined, { weekday: "short" });
		dayNames.createSpan({ text: day % 2 === 0 ? name : "" });
	}

	const cells = grid.createDiv({ cls: "examiner-heatmap-cells" });
	for (let index = 0; index < weeks * 7; index++) {
		const date = addLocalDays(weekStart, index);
		const cell = cells.createDiv({ cls: "examiner-heatmap-cell" });
		if (date > end || date < rangeStart) {
			cell.addClass("is-outside");
			continue;
		}
		const ms = daily.get(localDayKey(date)) ?? 0;
		total += ms;
		if (ms > 0) activeDays++;
		cell.addClass(`is-level-${heatmapLevel(ms)}`);
		const label = `${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}: ${ms > 0 ? formatDuration(ms) : "no study"}`;
		cell.setAttribute("aria-label", label);
		setTooltip(cell, label);
	}
	grid.setAttribute("aria-label", `Daily study time: ${activeDays} active ${activeDays === 1 ? "day" : "days"}, ${formatDuration(total)} in total.`);

	const legend = inner.createDiv({ cls: "examiner-heatmap-legend", attr: { "aria-hidden": "true" } });
	legend.createSpan({ text: "Less" });
	for (let level = 0; level <= 4; level++) legend.createSpan({ cls: `examiner-heatmap-cell is-level-${level}` });
	legend.createSpan({ text: "More" });

	window.requestAnimationFrame(() => {
		scroller.scrollLeft = scroller.scrollWidth;
	});
}

export interface BarRow {
	label: string;
	correct: number;
	total: number;
}

export function renderScoreBars(parent: HTMLElement, rows: readonly BarRow[]): void {
	const list = parent.createDiv({ cls: "examiner-bars" });
	for (const row of rows) {
		const share = row.total === 0 ? 0 : (row.correct / row.total) * 100;
		const item = list.createDiv({ cls: "examiner-bar-row" });
		item.createSpan({ cls: "examiner-bar-label", text: row.label, attr: { title: row.label } });
		const track = item.createDiv({ cls: "examiner-bar-track" });
		track.createDiv({ cls: "examiner-bar-fill" }).setCssProps({ "--examiner-share": `${share}%` });
		item.createSpan({ cls: "examiner-bar-value", text: formatScore(row.correct, row.total) });
		setTooltip(track, `${row.label}: ${formatMarks(row.correct)} of ${formatMarks(row.total)} marks (${formatPercent(share)})`);
	}
}
